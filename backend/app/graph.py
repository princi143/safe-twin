"""Stage 3 - TRACE. Dependency graph and blast-radius analysis with NetworkX."""
from __future__ import annotations

import networkx as nx


def build_graph(machines: list[dict], dependencies: list[dict]) -> nx.DiGraph:
    g = nx.DiGraph()
    for m in machines:
        g.add_node(m["id"], **m, capacity=60.0 / float(m["cycle_time_min"]))  # parts per hour
    for d in dependencies:
        g.add_edge(d["source"], d["target"], buffer_capacity=int(d["buffer_capacity"]))
    if not nx.is_directed_acyclic_graph(g):
        raise ValueError("The dependency graph must not contain cycles")
    return g


def steady_rates(g: nx.DiGraph, speed: dict[str, float] | None = None) -> dict[str, float]:
    """Steady-state output (parts/h) of every station: min(own capacity, what upstream can deliver)."""
    speed = speed or {}
    rates: dict[str, float] = {}
    for n in nx.topological_sort(g):
        cap = g.nodes[n]["capacity"] * speed.get(n, 1.0)
        preds = list(g.predecessors(n))
        if preds:
            # A station with several successors splits its output equally between them.
            supply = sum(rates[p] / max(g.out_degree(p), 1) for p in preds)
            rates[n] = min(cap, supply)
        else:
            rates[n] = cap
    return rates


def siblings(g: nx.DiGraph, machine_id: str) -> list[str]:
    """Parallel stations that can take rerouted work: same kind, feeding the same successors."""
    kind, succ = g.nodes[machine_id]["kind"], set(g.successors(machine_id))
    return [n for n in g.nodes
            if n != machine_id and g.nodes[n]["kind"] == kind and set(g.successors(n)) == succ]


def blast_radius(g: nx.DiGraph, machine_id: str) -> dict:
    """What a stop at `machine_id` does to every downstream station."""
    if machine_id not in g:
        raise KeyError(machine_id)
    base = steady_rates(g)
    down = steady_rates(g, {machine_id: 0.0})
    hops = nx.single_source_shortest_path_length(g, machine_id)

    affected = []
    for n in nx.descendants(g, machine_id):
        loss = 0.0 if base[n] == 0 else (base[n] - down[n]) / base[n]
        # Time until the station runs dry: the buffers on the way are assumed half full and
        # drain at the *net* rate (what the station consumes minus what still arrives).
        path = nx.shortest_path(g, machine_id, n)
        stock = sum(g.edges[a, b]["buffer_capacity"] / 2 for a, b in zip(path, path[1:]))
        deficit = base[n] - down[n]
        starve_min = None if deficit <= 1e-9 else round(stock / deficit * 60, 1)
        affected.append({
            "id": n, "name": g.nodes[n]["name"], "hops": hops[n],
            "baseline_rate": round(base[n], 1), "rate_if_down": round(down[n], 1),
            "throughput_loss_pct": round(loss * 100, 1),
            "starves_after_min": starve_min,
            "workers_nearby": g.nodes[n]["workers_nearby"],
        })
    affected.sort(key=lambda a: (a["hops"], a["id"]))

    sinks = [n for n in g.nodes if g.out_degree(n) == 0]
    line_base, line_down = sum(base[s] for s in sinks), sum(down[s] for s in sinks)
    # The bottleneck is the stage (group of parallel same-kind stations) with the least total capacity.
    stage_cap: dict[str, float] = {}
    for n in g.nodes:
        stage_cap[g.nodes[n]["kind"]] = stage_cap.get(g.nodes[n]["kind"], 0) + g.nodes[n]["capacity"]
    bottleneck_kind = min(stage_cap, key=stage_cap.get)
    return {
        "machine_id": machine_id,
        "affected": affected,
        "affected_ids": [a["id"] for a in affected],
        "edges": [[a, b] for a, b in g.edges if a == machine_id or a in hops and b in hops],
        "reroute_to": siblings(g, machine_id),
        "line_rate_baseline": round(line_base, 1),
        "line_rate_if_down": round(line_down, 1),
        "line_loss_pct": round(0 if line_base == 0 else (line_base - line_down) / line_base * 100, 1),
        "bottleneck_stage": [n for n in g.nodes if g.nodes[n]["kind"] == bottleneck_kind],
        "is_on_bottleneck": g.nodes[machine_id]["kind"] == bottleneck_kind,
        "workers_in_radius": g.nodes[machine_id]["workers_nearby"] + sum(a["workers_nearby"] for a in affected),
    }
