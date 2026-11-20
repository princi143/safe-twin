"""Stage 5 - DECIDE. Turns risk + trace + simulation into an explainable recommendation.

The output is advice for a human operator. Nothing here controls real equipment.
"""
from __future__ import annotations

from . import simulation as sim
from .twin import level_of

ADVISORY = ("Decision support only. This does not replace site lockout/tagout (LOTO) procedures, "
            "certified safety controls or qualified personnel.")


def _confidence(model_auc: float, completeness: float, stale: bool, margin: float) -> dict:
    model_part = max(0.0, min(1.0, (model_auc - 0.5) / 0.5))   # 0.5 AUC = no skill, 1.0 = perfect
    data_part = 0.0 if stale else completeness                  # share of the window with real readings
    margin_part = min(1.0, margin / 0.25)                       # how clearly the best option wins
    value = 0.4 * model_part + 0.35 * data_part + 0.25 * margin_part
    return {
        "value": round(value, 2),
        "label": "high" if value >= 0.75 else "medium" if value >= 0.5 else "low",
        "parts": {"model_skill": round(model_part, 2), "telemetry_completeness": round(data_part, 2),
                  "decision_margin": round(margin_part, 2)},
        "formula": "0.40 x model skill + 0.35 x telemetry completeness + 0.25 x decision margin",
    }


def build(machine: dict, live: dict, features: dict | None, drivers: list[dict], trace: dict,
          result: dict, model_metrics: dict) -> dict:
    by_key = {s["key"]: s for s in result["scenarios"]}
    best = by_key[result["recommended"]]
    a = by_key["A"]
    conf = _confidence(model_metrics["auc"], live["completeness"], live["stale"], result["score_margin"])

    reasons = [
        f"{machine['name']} has a {live['risk']:.0%} estimated chance of an unplanned bearing failure within "
        f"the next {result['horizon_min'] // 60} hours if it keeps running as it is.",
        f"Option {best['key']} ({best['name']}) has the best weighted trade-off across worker exposure, "
        f"throughput, cost and downtime.",
    ]
    if best["key"] != "A":
        reasons.append(
            f"Compared with continuing, it cuts the chance of an unplanned failure from "
            f"{a['unplanned_failure_probability']:.0%} to {best['unplanned_failure_probability']:.0%} and the "
            f"worker-exposure index from {a['worker_exposure_index']:.0f} to {best['worker_exposure_index']:.0f}.")
    else:
        reasons.append("The failure risk is low enough that intervening now would cost more output than it protects.")
    if trace["affected"]:
        reasons.append(
            f"A stop here reaches {len(trace['affected'])} downstream station(s) and removes "
            f"{trace['line_loss_pct']:.0f}% of line output while it lasts.")
    blocked = [s["key"] for s in result["scenarios"] if s["blocked_by_safety_gate"]]
    if blocked:
        reasons.append(f"Excluded by the safety gate (unplanned failure more likely than not): option {', '.join(blocked)}.")

    trade_offs = []
    for s in result["scenarios"]:
        if s["key"] == best["key"]:
            continue
        d_units = s["throughput_units"] - best["throughput_units"]
        d_exp = s["worker_exposure_index"] - best["worker_exposure_index"]
        trade_offs.append(
            f"Option {s['key']} ({s['name']}): {abs(d_units):.0f} {'more' if d_units >= 0 else 'fewer'} parts, "
            f"worker-exposure index {abs(d_exp):.0f} {'higher' if d_exp >= 0 else 'lower'}, "
            f"{s['unplanned_failure_probability']:.0%} chance of unplanned failure.")

    assumptions = [
        "One failure mode is modelled: progressive spindle/drive bearing wear.",
        "The risk score is converted to a constant failure rate over the shift; throttling to 60% load multiplies that rate by 0.4.",
        "After maintenance or repair the station is treated as healthy for the rest of the shift.",
        "Rerouting to a parallel station is only possible for planned stops; the parallel station then runs at 115%.",
        f"Cost uses INR {sim.UNIT_MARGIN} lost margin per part, INR {sim.PLANNED_REPAIR_COST} per planned and "
        f"INR {sim.UNPLANNED_REPAIR_COST} per unplanned repair (illustrative figures).",
        f"Worker exposure is a simplified 0-100 index: repair minutes x workers nearby, with planned work weighted "
        f"{sim.PLANNED_EXPOSURE_FACTOR} and emergency work 1.0. It is not a safety assessment.",
        f"Each option was replayed {result['replications']} times over {result['horizon_min']} minutes with fixed random seeds.",
        "The risk model was trained on synthetic data, not on measurements from a real plant.",
    ]
    if live["stale"]:
        assumptions.insert(0, "Telemetry is currently missing: the risk score is the last known value, so confidence is reduced.")

    return {
        "machine": {"id": machine["id"], "name": machine["name"]},
        "risk": {"score": round(live["risk"], 4), "level": level_of(live["risk"]), "stale": live["stale"],
                 "telemetry_completeness": live["completeness"], "inputs": features, "drivers": drivers,
                 "model": model_metrics},
        "trace": trace,
        "simulation": result,
        "recommended_option": best["key"],
        "recommended_name": best["name"],
        "reasons": reasons,
        "trade_offs": trade_offs,
        "assumptions": assumptions,
        "confidence": conf,
        "advisory": ADVISORY,
    }
