"""Stage 1 - DETECT. The virtual production cell: generates live sensor telemetry for every station.

There is no physical factory behind this prototype, so the cell simulates bearing wear and the
sensors that respond to it. Approved decisions are applied to this virtual cell only.
"""
from __future__ import annotations

from collections import deque
from datetime import datetime, timedelta, timezone

import numpy as np

from .risk import RiskModel, sensors_from_wear, window_features

RING = 300
SLOW_DRIFT = 0.00005      # normal wear per tick
FAULT_RATE = 0.0025       # accelerated wear per tick after a fault develops
RISK_SMOOTHING = 0.2      # exponential smoothing of the score, so one noisy window cannot flip the level
MAINTENANCE_TICKS = 20    # demo time compression: planned maintenance takes 20 ticks in the twin
INITIAL_WEAR = {"CNC-1": 0.50, "CNC-2": 0.12, "DEBURR": 0.20, "WASH": 0.28, "ASSEMBLY": 0.18, "INSPECT": 0.08}
DEVELOPING_FAULT = "CNC-1"  # the cell starts with a bearing fault developing here


def level_of(risk: float) -> str:
    return "high" if risk >= 0.6 else "watch" if risk >= 0.3 else "normal"


class VirtualCell:
    def __init__(self, machines: list[dict], maintenance_logs: list[dict], model: RiskModel,
                 window: int, tick_seconds: float, seed: int = 11) -> None:
        self.machines = {m["id"]: m for m in machines}
        self.model, self.window, self.tick_seconds = model, window, tick_seconds
        self._seed_logs = maintenance_logs
        self.rng = np.random.default_rng(seed)
        self.reset()

    # ----- lifecycle -------------------------------------------------------------------------
    def reset(self) -> None:
        now = datetime.now(timezone.utc)
        last: dict[str, datetime] = {}
        for log in self._seed_logs:
            ts = datetime.fromisoformat(str(log["performed_at"]).replace("Z", "+00:00"))
            if log["machine_id"] not in last or ts > last[log["machine_id"]]:
                last[log["machine_id"]] = ts
        self.state = {
            mid: {
                "wear": INITIAL_WEAR.get(mid, 0.15),
                "rate": FAULT_RATE if mid == DEVELOPING_FAULT else SLOW_DRIFT,
                "status": "running", "dropout": False,
                "maint_in": None, "maint_left": 0,
                "last_maint": last.get(mid, now - timedelta(hours=100)),
                "risk": 0.0, "stale": False, "completeness": 1.0, "features": None,
                "ring": deque(maxlen=RING),
            } for mid in self.machines
        }
        self.completed_maintenance: list[dict] = []
        # Back-fill one window so charts and scores are available immediately.
        start = now - timedelta(seconds=self.tick_seconds * self.window)
        for i in range(self.window):
            self.tick(start + timedelta(seconds=self.tick_seconds * i), advance=False)
        for s in self.state.values():      # the back-filled samples all carry the full-window score
            for sample in s["ring"]:
                sample["risk"] = round(s["risk"], 4)

    # ----- one telemetry tick ----------------------------------------------------------------
    def tick(self, ts: datetime | None = None, advance: bool = True) -> list[dict]:
        ts = ts or datetime.now(timezone.utc)
        rows = []
        for mid, s in self.state.items():
            if s["status"] == "maintenance":
                s["maint_left"] -= 1
                reading = (0.2, 30.0, 0.4)  # stopped and locked out
                if s["maint_left"] <= 0:
                    s.update(status="running", wear=0.05, rate=SLOW_DRIFT, last_maint=ts, risk=0.0)
                    s["ring"].clear()
                    self.completed_maintenance.append({
                        "machine_id": mid, "performed_at": ts.isoformat(), "kind": "planned",
                        "duration_min": float(self.machines[mid]["planned_repair_min"]),
                        "notes": "Planned maintenance approved through SAFE-TWIN (virtual cell)",
                    })
            else:
                if advance:
                    rate = s["rate"] * (0.4 if s["status"] == "throttled" else 1.0)
                    s["wear"] = min(s["wear"] + rate, 0.97)
                    if s["maint_in"] is not None:
                        s["maint_in"] -= 1
                        if s["maint_in"] <= 0:
                            s.update(status="maintenance", maint_left=MAINTENANCE_TICKS, maint_in=None)
                reading = sensors_from_wear(s["wear"], self.rng)
                if s["status"] == "throttled":  # lower load: less vibration and current
                    reading = (reading[0] * 0.8, reading[1] - 3.0, reading[2] * 0.7)
            vib, temp, cur = (None, None, None) if s["dropout"] else reading

            sample = {"ts": ts.isoformat(), "vibration": vib, "temperature": temp, "current": cur}
            s["ring"].append(sample)
            if s["status"] != "maintenance":
                window = list(s["ring"])[-self.window:]
                hours = (ts - s["last_maint"]).total_seconds() / 3600
                feats, s["completeness"] = window_features(window, hours)
                if feats is None:
                    s["stale"] = True            # too little telemetry: keep the last known score
                else:
                    raw = self.model.score(feats)
                    fresh = len(s["ring"]) <= 1 or not advance   # no history yet: take the score as is
                    s["risk"] = raw if fresh else s["risk"] + RISK_SMOOTHING * (raw - s["risk"])
                    s["features"], s["stale"] = feats, False
            sample["risk"] = round(s["risk"], 4)
            rows.append({"machine_id": mid, "ts": sample["ts"], "vibration": vib, "temperature": temp, "current": cur})
        return rows

    # ----- views -----------------------------------------------------------------------------
    def snapshot(self) -> dict:
        out = []
        for mid, s in self.state.items():
            last = s["ring"][-1] if s["ring"] else {}
            out.append({
                "id": mid, "status": s["status"], "risk": round(s["risk"], 4),
                "level": "maintenance" if s["status"] == "maintenance" else level_of(s["risk"]),
                "stale": s["stale"], "completeness": round(s["completeness"], 2),
                "sensor_dropout": s["dropout"],
                "maintenance_pending": s["maint_in"] is not None,
                "vibration": last.get("vibration"), "temperature": last.get("temperature"),
                "current": last.get("current"), "ts": last.get("ts"),
            })
        return {"ts": datetime.now(timezone.utc).isoformat(), "machines": out}

    def history(self, mid: str, limit: int = 150) -> list[dict]:
        return list(self.state[mid]["ring"])[-limit:]

    # ----- operator-facing actions -----------------------------------------------------------
    def inject_fault(self, mid: str) -> None:
        s = self.state[mid]
        s["rate"] = FAULT_RATE
        s["wear"] = max(s["wear"], 0.45)

    def set_dropout(self, mid: str, enabled: bool) -> None:
        self.state[mid]["dropout"] = enabled

    def apply_option(self, mid: str, option: str) -> str:
        """Apply an operator-approved option to the virtual cell. Returns what was done."""
        s = self.state[mid]
        if s["status"] == "maintenance":
            return "Station is already in maintenance; nothing changed."
        if option == "A":
            return "No change: station keeps running and stays under monitoring."
        if option == "B":
            s.update(status="throttled", maint_in=60)
            return "Station throttled to 60%; maintenance scheduled in the virtual cell."
        if option == "C":
            s.update(status="maintenance", maint_left=MAINTENANCE_TICKS, maint_in=None)
            return "Controlled shutdown started; station is in maintenance in the virtual cell."
        if option == "D":
            s.update(maint_in=30)
            return "Maintenance scheduled for the next break in the virtual cell."
        return "Unknown option; nothing changed."
