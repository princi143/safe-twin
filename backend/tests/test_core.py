"""Evaluation checks from the SAFE-TWIN roadmap. Run with: pytest (from the backend folder)."""
from fastapi.testclient import TestClient

from app import seed_data, simulation
from app.graph import blast_radius, build_graph, steady_rates
from app.risk import RiskModel, synthetic_training_set, window_features


def _graph():
    return build_graph(seed_data.MACHINES, seed_data.DEPENDENCIES)


def _model():
    m = RiskModel()
    m.train(synthetic_training_set(), "test")
    return m


# --- risk estimation accuracy ---------------------------------------------------------------
def test_risk_model_is_accurate_and_monotonic():
    m = _model()
    assert m.metrics["auc"] > 0.85
    healthy = dict(vib_mean=2.1, vib_std=0.2, vib_slope=0.0, temp_mean=56, current_mean=12.1, hours_since_maint=40)
    worn = dict(vib_mean=6.5, vib_std=0.6, vib_slope=0.03, temp_mean=76, current_mean=14.5, hours_since_maint=500)
    assert m.score(healthy) < 0.1 < 0.8 < m.score(worn)
    drivers = m.explain(worn)
    assert sum(d["contribution"] for d in drivers) > 0 and len(drivers) == 6


# --- resilience under missing telemetry -----------------------------------------------------
def test_missing_telemetry_is_reported_not_guessed():
    full = [dict(vibration=2.0 + 0.01 * i, temperature=55.0, current=12.0) for i in range(30)]
    feats, completeness = window_features(full, 10)
    assert feats is not None and completeness == 1.0
    gappy = [s if i % 2 else dict(vibration=None, temperature=None, current=None) for i, s in enumerate(full)]
    feats, completeness = window_features(gappy, 10)
    assert feats is not None and completeness == 0.5 and abs(feats["vib_slope"] - 0.01) < 1e-6
    dead = [dict(vibration=None, temperature=None, current=None)] * 30
    assert window_features(dead, 10) == (None, 0.0)


# --- dependency graph / blast radius --------------------------------------------------------
def test_blast_radius():
    g = _graph()
    assert round(steady_rates(g)["INSPECT"]) == 40          # two CNC mills at 20 parts/h each
    cnc = blast_radius(g, "CNC-1")
    assert cnc["affected_ids"] == ["DEBURR", "WASH", "ASSEMBLY", "INSPECT"]
    assert cnc["line_loss_pct"] == 50 and cnc["reroute_to"] == ["CNC-2"] and cnc["is_on_bottleneck"]
    wash = blast_radius(g, "WASH")
    assert wash["affected_ids"] == ["ASSEMBLY", "INSPECT"] and wash["line_loss_pct"] == 100
    assert wash["reroute_to"] == []


# --- simulation fidelity --------------------------------------------------------------------
def test_simulation_matches_analytic_throughput_and_is_replayable():
    g = _graph()
    a = simulation.simulate(g, "CNC-1", 0.7, seed_data.WORK_ORDERS, replications=20)
    b = simulation.simulate(g, "CNC-1", 0.7, seed_data.WORK_ORDERS, replications=20)
    assert a == b                                            # same seed, same answer
    assert abs(a["baseline_throughput_units"] - 320) < 12    # 40 parts/h x 8 h, plus buffer stock at shift start
    s = {x["key"]: x for x in a["scenarios"]}
    assert s["A"]["unplanned_failure_probability"] > s["B"]["unplanned_failure_probability"]
    assert s["C"]["unplanned_failure_probability"] < 0.1     # only the 10-minute ramp-down is exposed
    assert s["C"]["worker_exposure_index"] < s["A"]["worker_exposure_index"]
    assert a["recommended"] != "A" and s["A"]["blocked_by_safety_gate"]


def test_low_risk_recommends_continuing():
    r = simulation.simulate(_graph(), "CNC-2", 0.02, seed_data.WORK_ORDERS, replications=20)
    assert r["recommended"] == "A"


# --- API + human-in-the-loop audit trail ----------------------------------------------------
def test_api_end_to_end(monkeypatch):
    monkeypatch.setattr("app.config.SUPABASE_URL", "")
    from app.main import app
    with TestClient(app) as c:
        assert c.get("/api/health").json()["store"] == "memory"
        assert len(c.get("/api/factory").json()["machines"]) == 6
        assert len(c.get("/api/machines/CNC-1/telemetry").json()) >= 30
        assert c.get("/api/machines/CNC-1/risk").json()["drivers"]
        rec = c.post("/api/simulate", json={"machine_id": "CNC-1", "replications": 10}).json()
        assert rec["payload"]["reasons"] and rec["payload"]["assumptions"]
        url = f"/api/recommendations/{rec['id']}/decision"
        # an override must name a different option and give a reason
        assert c.post(url, json={"operator": "Asha", "action": "overridden"}).status_code == 422
        ok = c.post(url, json={"operator": "Asha", "action": "approved"})
        assert ok.status_code == 200 and ok.json()["chosen_option"] == rec["recommended_option"]
        assert c.post(url, json={"operator": "Asha", "action": "rejected"}).status_code == 409
        log = c.get("/api/audit").json()
        assert log[0]["operator"] == "Asha" and log[0]["machine_id"] == "CNC-1"
        with c.websocket_connect("/ws") as ws:
            assert len(ws.receive_json()["machines"]) == 6
