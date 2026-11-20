"""Stage 4 - SIMULATE. Counterfactual "what-if" comparison with a SimPy discrete-event model.

Every option is replayed over one 8-hour shift, many times with fixed random seeds, so the same
inputs always give the same comparison. Time unit: minutes.
"""
from __future__ import annotations

import math
import random
from dataclasses import asdict, dataclass

import networkx as nx
import simpy

from .graph import siblings

# Economic assumptions (illustrative, shown to the operator with every recommendation).
UNIT_MARGIN = 1200          # INR contribution lost per part not produced
PLANNED_REPAIR_COST = 18000   # INR
UNPLANNED_REPAIR_COST = 75000  # INR, includes secondary damage and call-out
PLANNED_EXPOSURE_FACTOR = 0.25  # planned, locked-out work is rated 1/4 as hazardous per minute as emergency work
WEIGHTS = {"worker_exposure": 0.35, "throughput_loss": 0.30, "cost": 0.20, "downtime": 0.15}
SAFETY_GATE = 0.5           # options whose unplanned-failure probability exceeds this are never recommended


@dataclass(frozen=True)
class Scenario:
    key: str
    name: str
    description: str
    speed: float = 1.0               # target speed until maintenance
    hazard_multiplier: float = 1.0   # effect of that speed/load on the failure rate
    maintenance_at: float | None = None  # minute at which planned maintenance starts
    sibling_boost: float = 1.0       # speed of parallel stations while the target is in planned maintenance


def scenarios_for(has_sibling: bool) -> list[Scenario]:
    boost = 1.15 if has_sibling else 1.0
    reroute = "; active work orders are rerouted to the parallel station" if has_sibling else ""
    return [
        Scenario("A", "Continue and monitor", "Keep running at full speed and watch the telemetry closely."),
        Scenario("B", "Throttle and prepare", "Run at 60% speed/load to slow the wear, maintain at mid-shift (minute 240).",
                 speed=0.6, hazard_multiplier=0.4, maintenance_at=240),
        Scenario("C", "Controlled shutdown now", f"Ramp down over 10 minutes and maintain immediately{reroute}.",
                 maintenance_at=10, sibling_boost=boost),
        Scenario("D", "Defer to next break", f"Keep full speed until the scheduled break (minute 120), then maintain{reroute}.",
                 maintenance_at=120, sibling_boost=boost),
    ]


class _Station:
    __slots__ = ("id", "cycle", "inbuf", "out", "down", "pre_speed", "boost", "boost_window",
                 "busy", "starved", "blocked")

    def __init__(self, sid: str, cycle: float) -> None:
        self.id, self.cycle = sid, cycle
        self.inbuf = self.out = None
        self.down: tuple[float, float] | None = None
        self.pre_speed = 1.0
        self.boost, self.boost_window = 1.0, None
        self.busy = self.starved = self.blocked = 0.0

    def speed_at(self, t: float) -> float:
        if self.down and t < self.down[0]:
            return self.pre_speed
        if self.boost_window and self.boost_window[0] <= t < self.boost_window[1]:
            return self.boost
        return 1.0


def _run_once(g: nx.DiGraph, target: str | None, sc: Scenario | None, risk: float,
              horizon: float, seed: int) -> dict:
    rng = random.Random(seed)
    env = simpy.Environment()
    stations = {n: _Station(n, float(g.nodes[n]["cycle_time_min"])) for n in g.nodes}
    for n, st in stations.items():
        if g.in_degree(n):
            cap = max(g.edges[p, n]["buffer_capacity"] for p in g.predecessors(n))
            st.inbuf = simpy.Container(env, capacity=cap, init=cap // 2)
    for n, st in stations.items():
        succ = list(g.successors(n))
        st.out = stations[succ[0]].inbuf if succ else None

    unplanned = False
    planned_min = unplanned_min = 0.0
    if target is not None and sc is not None:
        t = stations[target]
        node = g.nodes[target]
        # risk = P(failure within the horizon at full speed)  ->  constant hazard rate per minute
        lam = -math.log(max(1.0 - risk, 1e-6)) / horizon * sc.hazard_multiplier
        t_fail = rng.expovariate(lam) if lam > 0 else math.inf
        t.pre_speed = sc.speed
        if sc.maintenance_at is not None and t_fail > sc.maintenance_at:
            dur = float(node["planned_repair_min"])
            t.down = (sc.maintenance_at, sc.maintenance_at + dur)
            planned_min = min(dur, horizon - sc.maintenance_at)
            for s in siblings(g, target):
                stations[s].boost, stations[s].boost_window = sc.sibling_boost, t.down
        elif t_fail < horizon:
            dur = float(node["unplanned_repair_min"])
            t.down = (t_fail, t_fail + dur)
            unplanned, unplanned_min = True, min(dur, horizon - t_fail)

    done_times: list[float] = []

    def run(st: _Station):
        while True:
            if st.down and st.down[0] <= env.now < st.down[1]:
                yield env.timeout(st.down[1] - env.now)
            if st.inbuf is not None:
                t0 = env.now
                yield st.inbuf.get(1)
                st.starved += env.now - t0
                if st.down and st.down[0] <= env.now < st.down[1]:
                    yield env.timeout(st.down[1] - env.now)
            ct = st.cycle / st.speed_at(env.now) * rng.uniform(0.92, 1.08)
            if st.down and env.now < st.down[0] < env.now + ct:  # stop hits mid-cycle: finish afterwards
                yield env.timeout(ct + st.down[1] - st.down[0])
            else:
                yield env.timeout(ct)
            st.busy += ct
            if st.out is not None:
                t1 = env.now
                yield st.out.put(1)
                st.blocked += env.now - t1
            else:
                done_times.append(env.now)

    for st in stations.values():
        env.process(run(st))
    env.run(until=horizon)

    return {
        "throughput": len(done_times),
        "done_times": done_times,
        "unplanned": unplanned,
        "planned_min": planned_min,
        "unplanned_min": unplanned_min,
        "starved": {n: s.starved for n, s in stations.items()},
        "utilisation": {n: s.busy / horizon for n, s in stations.items()},
    }


def _mean(xs) -> float:
    xs = list(xs)
    return sum(xs) / len(xs) if xs else 0.0


def _pct(xs: list[float], q: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, max(0, round(q * (len(xs) - 1))))]


def _orders_met(runs: list[dict], work_orders: list[dict]) -> list[dict]:
    """Probability that each work order is complete by its due time (orders are produced in due order)."""
    out, cumulative = [], 0
    for wo in sorted(work_orders, key=lambda w: w["due_in_min"]):
        cumulative += int(wo["quantity"])
        met = _mean(sum(1 for t in r["done_times"] if t <= wo["due_in_min"]) >= cumulative for r in runs)
        out.append({"id": wo["id"], "product": wo["product"], "due_in_min": wo["due_in_min"],
                    "on_time_probability": round(met, 2)})
    return out


def simulate(g: nx.DiGraph, machine_id: str, risk: float, work_orders: list[dict],
             horizon: float = 480, replications: int = 60, seed: int = 42) -> dict:
    node = g.nodes[machine_id]
    downstream = list(nx.descendants(g, machine_id))
    workers = int(node["workers_nearby"])
    worst_exposure = float(node["unplanned_repair_min"]) * workers  # normaliser for the 0-100 index

    base_runs = [_run_once(g, None, None, 0, horizon, seed + i) for i in range(replications)]
    base_tp = _mean(r["throughput"] for r in base_runs)
    base_starved = {n: _mean(r["starved"][n] for r in base_runs) for n in g.nodes}

    results = []
    for k, sc in enumerate(scenarios_for(bool(siblings(g, machine_id)))):
        runs = [_run_once(g, machine_id, sc, risk, horizon, seed + 1000 * (k + 1) + i) for i in range(replications)]
        tp = [r["throughput"] for r in runs]
        p_fail = _mean(r["unplanned"] for r in runs)
        planned, unplanned = _mean(r["planned_min"] for r in runs), _mean(r["unplanned_min"] for r in runs)
        exposure = (unplanned + PLANNED_EXPOSURE_FACTOR * planned) * workers / worst_exposure * 100
        lost_units = max(base_tp - _mean(tp), 0)
        cost = (lost_units * UNIT_MARGIN + p_fail * UNPLANNED_REPAIR_COST
                + _mean(r["planned_min"] > 0 for r in runs) * PLANNED_REPAIR_COST)
        extra_starved = _mean(
            max(_mean(r["starved"][n] for r in runs) - base_starved[n], 0) for n in downstream) if downstream else 0.0
        util = {n: _mean(r["utilisation"][n] for r in runs) for n in g.nodes}
        orders = _orders_met(runs, work_orders)
        results.append({
            **{f: v for f, v in asdict(sc).items() if f in ("key", "name", "description")},
            "parameters": {"speed": sc.speed, "hazard_multiplier": sc.hazard_multiplier,
                           "maintenance_at_min": sc.maintenance_at, "sibling_boost": sc.sibling_boost},
            "unplanned_failure_probability": round(p_fail, 3),
            "throughput_units": round(_mean(tp), 1),
            "throughput_p05": _pct(tp, 0.05), "throughput_p95": _pct(tp, 0.95),
            "throughput_loss_units": round(lost_units, 1),
            "throughput_loss_pct": round(lost_units / base_tp * 100, 1) if base_tp else 0,
            "downtime_min": round(planned + unplanned, 1),
            "planned_downtime_min": round(planned, 1), "unplanned_downtime_min": round(unplanned, 1),
            "downstream_starved_min": round(extra_starved, 1),
            "bottleneck_station": max(util, key=util.get),
            "worker_exposure_index": round(exposure, 1),
            "estimated_cost": round(cost),
            "orders": orders,
            "orders_at_risk": sum(1 for o in orders if o["on_time_probability"] < 0.8),
        })

    # Weighted multi-objective score: each metric is scaled 0..1 across the options, lower is better.
    metric_of = {"worker_exposure": "worker_exposure_index", "throughput_loss": "throughput_loss_units",
                 "cost": "estimated_cost", "downtime": "downtime_min"}
    for w, field in metric_of.items():
        lo, hi = min(r[field] for r in results), max(r[field] for r in results)
        for r in results:
            r.setdefault("score_parts", {})[w] = round(0 if hi == lo else (r[field] - lo) / (hi - lo) * WEIGHTS[w], 4)
    for r in results:
        r["score"] = round(sum(r["score_parts"].values()), 4)
        r["blocked_by_safety_gate"] = r["unplanned_failure_probability"] > SAFETY_GATE
    eligible = [r for r in results if not r["blocked_by_safety_gate"]] or results
    ranked = sorted(eligible, key=lambda r: r["score"])
    margin = ranked[1]["score"] - ranked[0]["score"] if len(ranked) > 1 else 1.0

    return {
        "machine_id": machine_id, "risk_used": round(risk, 4),
        "horizon_min": horizon, "replications": replications, "seed": seed,
        "baseline_throughput_units": round(base_tp, 1),
        "scenarios": results,
        "recommended": ranked[0]["key"],
        "score_margin": round(margin, 4),
        "weights": WEIGHTS,
    }
