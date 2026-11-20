"""Stage 2 - PREDICT. Failure-risk scoring for one failure mode: spindle/drive bearing wear.

The score is P(unplanned failure within the next 8-hour shift if the machine keeps running as it is).
"""
from __future__ import annotations

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import train_test_split

FEATURES = ["vib_mean", "vib_std", "vib_slope", "temp_mean", "current_mean", "hours_since_maint"]
FEATURE_LABELS = {
    "vib_mean": ("Vibration level", "mm/s"),
    "vib_std": ("Vibration variability", "mm/s"),
    "vib_slope": ("Vibration trend", "mm/s per sample"),
    "temp_mean": ("Bearing temperature", "°C"),
    "current_mean": ("Motor current", "A"),
    "hours_since_maint": ("Hours since maintenance", "h"),
}
# Physical components each station is broken into, and the sensor signal that watches each one.
COMPONENTS = [
    {"key": "bearing", "name": "Spindle / drive bearing", "features": ["vib_mean", "vib_std", "vib_slope"],
     "signal": "vib_mean", "signal_label": "Vibration", "unit": "mm/s"},
    {"key": "motor", "name": "Drive motor", "features": ["current_mean"],
     "signal": "current_mean", "signal_label": "Motor current", "unit": "A"},
    {"key": "housing", "name": "Housing and lubrication", "features": ["temp_mean"],
     "signal": "temp_mean", "signal_label": "Temperature", "unit": "°C"},
]
MIN_VALID_SAMPLES = 12  # fewer valid readings than this in the window: no new score


def sensors_from_wear(wear: float, rng: np.random.Generator) -> tuple[float, float, float]:
    """Sensor response to hidden bearing wear (0 = new, 1 = failed). Shared by the twin and the trainer."""
    spread = 0.15 + 0.5 * wear
    vibration = 2.0 + 6.0 * wear * wear + rng.normal(0, spread)
    temperature = 55.0 + 25.0 * wear + rng.normal(0, 1.5)
    current = 12.0 + 3.0 * wear + rng.normal(0, 0.4)
    return float(max(vibration, 0.05)), float(temperature), float(current)


def synthetic_training_set(n: int = 4000, seed: int = 7) -> list[dict]:
    """Same generative model as supabase/seed.sql - used when Supabase has no training data."""
    rng = np.random.default_rng(seed)
    wear = rng.random(n) ** 1.3
    rate = np.where(rng.random(n) < 0.3, 0.001 + 0.004 * rng.random(n), 0.0)
    p_fail = 1.0 / (1.0 + np.exp(-9.0 * (wear + 40.0 * rate - 0.62)))
    cols = {
        "vib_mean": 2.0 + 6.0 * wear**2 + rng.normal(0, 0.25, n),
        "vib_std": np.maximum(0.05, 0.15 + 0.5 * wear + rng.normal(0, 0.05, n)),
        "vib_slope": 12.0 * wear * rate + rng.normal(0, 0.008, n),
        "temp_mean": 55.0 + 25.0 * wear + rng.normal(0, 1.5, n),
        "current_mean": 12.0 + 3.0 * wear + rng.normal(0, 0.4, n),
        "hours_since_maint": 20.0 + 600.0 * wear * (0.5 + rng.random(n)),
        "failed_within_horizon": rng.random(n) < p_fail,
    }
    return [{k: (bool(v[i]) if k == "failed_within_horizon" else float(v[i])) for k, v in cols.items()}
            for i in range(n)]


def window_features(samples: list[dict], hours_since_maint: float) -> tuple[dict | None, float]:
    """Rolling-window features. Returns (features or None, completeness 0..1).

    Missing readings (None) are skipped; if too few remain the caller keeps the last known score.
    """
    if not samples:
        return None, 0.0
    idx = [i for i, s in enumerate(samples) if s.get("vibration") is not None]
    completeness = len(idx) / len(samples)
    if len(idx) < MIN_VALID_SAMPLES:
        return None, completeness
    vib = np.array([samples[i]["vibration"] for i in idx], dtype=float)
    temp = np.array([samples[i]["temperature"] for i in idx], dtype=float)
    cur = np.array([samples[i]["current"] for i in idx], dtype=float)
    slope = float(np.polyfit(np.array(idx, dtype=float), vib, 1)[0])
    return {
        "vib_mean": float(vib.mean()),
        "vib_std": float(vib.std()),
        "vib_slope": slope,
        "temp_mean": float(temp.mean()),
        "current_mean": float(cur.mean()),
        "hours_since_maint": float(hours_since_maint),
    }, completeness


class RiskModel:
    def __init__(self) -> None:
        self.model = GradientBoostingClassifier(n_estimators=150, max_depth=3, learning_rate=0.08, random_state=0)
        self.metrics: dict = {}
        self.baseline: dict[str, float] = {}
        self.worn: dict[str, float] = {}

    def train(self, samples: list[dict], source: str) -> None:
        X = np.array([[float(s[f]) for f in FEATURES] for s in samples])
        y = np.array([bool(s["failed_within_horizon"]) for s in samples])
        X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.25, random_state=0, stratify=y)
        self.model.fit(X_tr, y_tr)
        p = self.model.predict_proba(X_te)[:, 1]
        self.metrics = {
            "algorithm": "scikit-learn GradientBoostingClassifier",
            "training_source": source,
            "n_train": int(len(y_tr)),
            "n_test": int(len(y_te)),
            "failure_rate": round(float(y.mean()), 3),
            "auc": round(float(roc_auc_score(y_te, p)), 3),
            "brier": round(float(brier_score_loss(y_te, p)), 4),
        }
        # "Healthy" reference point = median of samples that did not fail. Used for explanations.
        healthy = X[~y]
        self.baseline = {f: float(np.median(healthy[:, i])) for i, f in enumerate(FEATURES)}
        # "Worn" reference point = median of samples that did fail. Used to grade component condition.
        self.worn = {f: float(np.median(X[y][:, i])) for i, f in enumerate(FEATURES)}

    def score(self, features: dict) -> float:
        x = np.array([[features[f] for f in FEATURES]])
        return float(self.model.predict_proba(x)[0, 1])

    def score_many(self, rows: list[dict]) -> list[float]:
        if not rows:
            return []
        x = np.array([[r[f] for f in FEATURES] for r in rows])
        return [float(v) for v in self.model.predict_proba(x)[:, 1]]

    def explain(self, features: dict) -> list[dict]:
        """Per-input contribution: how much the risk drops if that one input is set back to its healthy value."""
        base = self.score(features)
        variants = [{**features, f: self.baseline[f]} for f in FEATURES]
        out = []
        for f, p in zip(FEATURES, self.score_many(variants)):
            label, unit = FEATURE_LABELS[f]
            out.append({
                "feature": f, "label": label, "unit": unit,
                "value": round(features[f], 4), "healthy_value": round(self.baseline[f], 4),
                "contribution": round(base - p, 4),
            })
        return sorted(out, key=lambda d: -abs(d["contribution"]))

    def components(self, features: dict | None, drivers: list[dict] | None = None) -> list[dict]:
        """Condition of each physical component, graded between the healthy and worn reference values.

        `deviation` is 0 at the healthy reference and 1 at the worn reference. If model drivers are
        given, the component whose signals contribute most to the risk is marked as the fault location.
        """
        out = []
        contrib = {d["feature"]: d["contribution"] for d in (drivers or [])}
        for c in COMPONENTS:
            if features is None:
                out.append({**{k: c[k] for k in ("key", "name", "signal_label", "unit")},
                            "value": None, "healthy_value": round(self.baseline[c["signal"]], 2),
                            "deviation": None, "status": "unknown", "contribution": 0.0, "fault_location": False})
                continue
            f = c["signal"]
            span = self.worn[f] - self.baseline[f]
            dev = 0.0 if span <= 0 else (features[f] - self.baseline[f]) / span
            dev = float(max(0.0, min(dev, 1.5)))
            out.append({**{k: c[k] for k in ("key", "name", "signal_label", "unit")},
                        "value": round(features[f], 2), "healthy_value": round(self.baseline[f], 2),
                        "deviation": round(dev, 2),
                        "status": "fault" if dev >= 0.75 else "watch" if dev >= 0.35 else "normal",
                        "contribution": round(sum(contrib.get(x, 0.0) for x in c["features"]), 4),
                        "fault_location": False})
        if drivers and features is not None:
            top = max(out, key=lambda c: c["contribution"])
            if top["contribution"] > 0.05:
                top["fault_location"] = True
        return out
