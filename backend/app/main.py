"""SAFE-TWIN API: DETECT -> PREDICT -> TRACE -> SIMULATE -> DECIDE."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config, decision, simulation
from .graph import blast_radius, build_graph
from .risk import RiskModel, synthetic_training_set
from .store import make_store
from .twin import VirtualCell

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("safe-twin")


class Ctx:
    store = None
    store_note = ""
    model: RiskModel = None
    cell: VirtualCell = None
    graph = None
    machines: list[dict] = []
    dependencies: list[dict] = []
    work_orders: list[dict] = []
    sockets: set[WebSocket] = set()


ctx = Ctx()


def _startup() -> None:
    ctx.store, ctx.store_note = make_store(config.SUPABASE_URL, config.SUPABASE_KEY)
    log.info(ctx.store_note)
    ctx.machines = ctx.store.machines()
    ctx.dependencies = ctx.store.dependencies()
    ctx.work_orders = ctx.store.work_orders()
    ctx.graph = build_graph(ctx.machines, ctx.dependencies)

    samples = ctx.store.training_samples()
    source = "Supabase table training_samples"
    if len(samples) < 200:
        samples, source = synthetic_training_set(), "built-in synthetic generator"
    ctx.model = RiskModel()
    ctx.model.train(samples, source)
    log.info("Risk model trained: %s", ctx.model.metrics)
    ctx.cell = VirtualCell(ctx.machines, ctx.store.maintenance_logs(), ctx.model,
                           config.WINDOW, config.TICK_SECONDS)


async def _telemetry_loop() -> None:
    tick = 0
    while True:
        await asyncio.sleep(config.TICK_SECONDS)
        tick += 1
        try:
            rows = ctx.cell.tick()
            done, ctx.cell.completed_maintenance = ctx.cell.completed_maintenance, []
            if tick % config.PERSIST_EVERY_TICKS == 0:
                await asyncio.to_thread(ctx.store.insert_telemetry, rows)
            for entry in done:
                await asyncio.to_thread(ctx.store.insert_maintenance, entry)
        except Exception:  # noqa: BLE001 - never let one bad tick stop the stream
            log.exception("telemetry tick failed")
        snap = ctx.cell.snapshot()
        for ws in list(ctx.sockets):
            try:
                await ws.send_json(snap)
            except Exception:  # noqa: BLE001
                ctx.sockets.discard(ws)


@asynccontextmanager
async def lifespan(_: FastAPI):
    _startup()
    task = asyncio.create_task(_telemetry_loop())
    yield
    task.cancel()


app = FastAPI(title="SAFE-TWIN", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


def _machine(machine_id: str) -> dict:
    m = next((m for m in ctx.machines if m["id"] == machine_id), None)
    if m is None:
        raise HTTPException(404, f"Unknown machine '{machine_id}'")
    return m


# ---- DETECT ------------------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok", "store": ctx.store.name, "store_note": ctx.store_note,
            "model": ctx.model.metrics, "tick_seconds": config.TICK_SECONDS, "advisory": decision.ADVISORY}


@app.get("/api/factory")
def factory():
    return {"machines": ctx.machines, "dependencies": ctx.dependencies, "work_orders": ctx.work_orders}


@app.get("/api/state")
def state():
    return ctx.cell.snapshot()


@app.get("/api/machines/{machine_id}/telemetry")
def telemetry(machine_id: str, limit: int = 150):
    _machine(machine_id)
    return ctx.cell.history(machine_id, max(1, min(limit, 300)))


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    ctx.sockets.add(ws)
    try:
        await ws.send_json(ctx.cell.snapshot())
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ctx.sockets.discard(ws)


# ---- PREDICT -----------------------------------------------------------------------------------
@app.get("/api/machines/{machine_id}/risk")
def risk(machine_id: str):
    _machine(machine_id)
    s = ctx.cell.state[machine_id]
    feats = s["features"]
    return {"machine_id": machine_id, "status": s["status"], "score": round(s["risk"], 4), "stale": s["stale"],
            "telemetry_completeness": round(s["completeness"], 2), "inputs": feats,
            "drivers": ctx.model.explain(feats) if feats else [], "model": ctx.model.metrics}


# ---- TRACE -------------------------------------------------------------------------------------
@app.get("/api/trace/{machine_id}")
def trace(machine_id: str):
    _machine(machine_id)
    return blast_radius(ctx.graph, machine_id)


# ---- SIMULATE + DECIDE -------------------------------------------------------------------------
class SimulateIn(BaseModel):
    machine_id: str
    replications: int = Field(default=config.REPLICATIONS, ge=10, le=300)


@app.post("/api/simulate")
def run_simulation(body: SimulateIn):
    machine = _machine(body.machine_id)
    s = ctx.cell.state[body.machine_id]
    if s["status"] == "maintenance":
        raise HTTPException(409, "This station is in maintenance; there is nothing to simulate.")
    live = {"risk": s["risk"], "stale": s["stale"], "completeness": round(s["completeness"], 2)}
    feats = s["features"]
    result = simulation.simulate(ctx.graph, body.machine_id, live["risk"], ctx.work_orders,
                                 horizon=config.HORIZON_MIN, replications=body.replications)
    payload = decision.build(machine, live, feats, ctx.model.explain(feats) if feats else [],
                             blast_radius(ctx.graph, body.machine_id), result, ctx.model.metrics)
    rec = ctx.store.insert_recommendation({
        "machine_id": body.machine_id, "risk_score": round(live["risk"], 4),
        "confidence": payload["confidence"]["value"],
        "recommended_option": payload["recommended_option"], "payload": payload,
    })
    return rec


@app.get("/api/recommendations")
def recommendations(limit: int = 20):
    return ctx.store.list_recommendations(max(1, min(limit, 100)))


class DecisionIn(BaseModel):
    operator: str = Field(min_length=2, max_length=80)
    action: Literal["approved", "rejected", "overridden"]
    chosen_option: Literal["A", "B", "C", "D"] | None = None
    note: str = Field(default="", max_length=500)


@app.post("/api/recommendations/{rec_id}/decision")
def decide(rec_id: str, body: DecisionIn):
    rec = ctx.store.get_recommendation(rec_id)
    if rec is None:
        raise HTTPException(404, "Recommendation not found")
    if any(d["recommendation_id"] == rec_id for d in ctx.store.list_decisions(200)):
        raise HTTPException(409, "A decision has already been recorded for this recommendation.")
    if body.action == "approved":
        option = rec["recommended_option"]
    elif body.action == "overridden":
        if body.chosen_option is None or body.chosen_option == rec["recommended_option"]:
            raise HTTPException(422, "An override needs a chosen_option different from the recommendation.")
        if not body.note.strip():
            raise HTTPException(422, "An override needs a note explaining why.")
        option = body.chosen_option
    else:
        option = None
    dec = ctx.store.insert_decision({
        "recommendation_id": rec_id, "operator": body.operator.strip(), "action": body.action,
        "chosen_option": option, "note": body.note.strip() or None,
    })
    effect = ctx.cell.apply_option(rec["machine_id"], option) if option else "Recommendation rejected; nothing changed."
    return {**dec, "effect": effect}


@app.get("/api/audit")
def audit(limit: int = 50):
    recs = {r["id"]: r for r in ctx.store.list_recommendations(100)}
    out = []
    for d in ctx.store.list_decisions(max(1, min(limit, 200))):
        r = recs.get(d["recommendation_id"]) or ctx.store.get_recommendation(d["recommendation_id"]) or {}
        out.append({**d, "machine_id": r.get("machine_id"), "risk_score": r.get("risk_score"),
                    "confidence": r.get("confidence"), "recommended_option": r.get("recommended_option")})
    return out


# ---- Virtual-cell controls (demo / evaluation) -------------------------------------------------
class MachineIn(BaseModel):
    machine_id: str
    enabled: bool = True


@app.post("/api/demo/inject-fault")
def inject_fault(body: MachineIn):
    _machine(body.machine_id)
    ctx.cell.inject_fault(body.machine_id)
    return {"ok": True}


@app.post("/api/demo/sensor-dropout")
def sensor_dropout(body: MachineIn):
    _machine(body.machine_id)
    ctx.cell.set_dropout(body.machine_id, body.enabled)
    return {"ok": True}


@app.post("/api/demo/reset")
def reset():
    ctx.cell.reset()
    return {"ok": True}
