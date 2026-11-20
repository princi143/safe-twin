"""Supervisor tools: load-capacity check, custom what-if runs and the shift (sign-in / sign-out) log."""
from __future__ import annotations

from datetime import datetime

import networkx as nx

from .graph import steady_rates
from .simulation import LOAD_EXPONENT, SAFETY_GATE, failure_probability, hazard_multiplier

WATCH = 0.30  # same threshold the dashboard uses for the "watch" level


def load_check(g: nx.DiGraph, machine_id: str, risk: float, load: float, hours: float) -> dict:
    """Can this station carry `load` (1.0 = nominal) for `hours`? Returns a verdict with the numbers behind it."""
    minutes = hours * 60
    p = failure_probability(risk, load, minutes)
    p_nominal = failure_probability(risk, 1.0, minutes)
    if p < WATCH:
        verdict, text = "yes", "The station can take this load for the period."
    elif p <= SAFETY_GATE:
        verdict, text = "caution", "Possible only with close monitoring and maintenance prepared."
    else:
        verdict, text = "no", "The station should not be given this load: a failure is more likely than not."

    # Highest load (in 5% steps, up to 130%) that keeps the failure chance under the watch threshold.
    safe = [x / 100 for x in range(40, 131, 5) if failure_probability(risk, x / 100, minutes) < WATCH]
    base, loaded = steady_rates(g), steady_rates(g, {machine_id: load})
    sinks = [n for n in g.nodes if g.out_degree(n) == 0]
    line_base, line_loaded = sum(base[s] for s in sinks), sum(loaded[s] for s in sinks)
    return {
        "machine_id": machine_id, "risk_score": round(risk, 4), "load_pct": round(load * 100), "hours": hours,
        "failure_probability": round(p, 3), "failure_probability_nominal": round(p_nominal, 3),
        "hazard_multiplier": round(hazard_multiplier(load), 2),
        "verdict": verdict, "verdict_text": text,
        "max_safe_load_pct": round(max(safe) * 100) if safe else None,
        "station_rate": round(g.nodes[machine_id]["capacity"] * load, 1),
        "line_rate": round(line_loaded, 1), "line_rate_nominal": round(line_base, 1),
        "assumptions": [
            "The risk score is the chance of failure in 8 hours at nominal load, treated as a constant failure rate.",
            f"Failure rate scales with load to the power {round(LOAD_EXPONENT, 2)} "
            "(so 60% load gives 0.4 times the rate, as in option B).",
            "Verdict thresholds: under 30% chance of failure = yes, 30-50% = with caution, over 50% = no.",
            "One failure mode (bearing wear) is modelled; this is advice, not a certified load rating.",
        ],
    }


def pair_sessions(events: list[dict]) -> list[dict]:
    """Turn the sign-in / sign-out event stream into one row per session, newest first."""
    sessions: dict[str, dict] = {}
    for e in sorted(events, key=lambda e: e["at"]):
        s = sessions.setdefault(e["session_id"], {"session_id": e["session_id"], "username": e["username"],
                                                  "role": e["role"], "login_at": None, "logout_at": None})
        s["login_at" if e["event"] == "login" else "logout_at"] = e["at"]
    out = []
    for s in sessions.values():
        if s["login_at"] and s["logout_at"]:
            a = datetime.fromisoformat(s["login_at"].replace("Z", "+00:00"))
            b = datetime.fromisoformat(s["logout_at"].replace("Z", "+00:00"))
            s["duration_min"] = round((b - a).total_seconds() / 60, 1)
        else:
            s["duration_min"] = None
        out.append(s)
    return sorted(out, key=lambda s: s["login_at"] or s["logout_at"] or "", reverse=True)
