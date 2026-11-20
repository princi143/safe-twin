# SAFE-TWIN

Factory-level failure impact and human-in-the-loop decision support for a virtual production cell.

Most predictive-maintenance tools stop at "machine X has an elevated failure risk". SAFE-TWIN goes on to
show what that failure does to the rest of the line, compares the ways an operator could respond, explains
its recommendation, and records what the operator decided.

| Stage | What it does | Where |
|---|---|---|
| 1 DETECT | Streams vibration, temperature and current for six stations (every 2 s, over WebSocket) | `backend/app/twin.py` |
| 2 PREDICT | Rolling-window features -> gradient-boosted model -> failure-risk score with per-input drivers | `backend/app/risk.py` |
| 3 TRACE | NetworkX dependency graph, blast radius, bottleneck and reroute options | `backend/app/graph.py` |
| 4 SIMULATE | SimPy discrete-event simulation of four options over an 8-hour shift, replayable | `backend/app/simulation.py` |
| 5 DECIDE | Explained recommendation, operator approve / reject / override, audit log | `backend/app/decision.py`, `main.py` |

**Stack:** FastAPI, scikit-learn, NetworkX, SimPy · React, TypeScript, Vite, Tailwind CSS, React Flow, ECharts · Supabase (Postgres).

## Run it locally

You need Python 3.11+ and Node 20+.

**1. Backend** (terminal 1)

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate      macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # Windows: copy .env.example .env   -> then paste your Supabase key into .env
uvicorn app.main:app --reload --port 8000
```

**2. Frontend** (terminal 2)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. API docs are at http://localhost:8000/docs.

Without a `.env` the app still runs, on built-in demo data held in memory (the header shows
"demo data · not saved"). With Supabase configured the header shows "Supabase connected".

## Supabase

The backend reads the cell layout, work orders, maintenance logs and model training data from Supabase,
and writes telemetry, recommendations and operator decisions back to it.

To set up a fresh project, run `supabase/schema.sql` and then `supabase/seed.sql` in the Supabase SQL editor.

| Table | Contents |
|---|---|
| `machines`, `dependencies` | Stations and the links (with buffer sizes) between them |
| `work_orders` | Active production schedule for the shift |
| `maintenance_logs` | Maintenance history; new entries are added when approved maintenance completes |
| `training_samples` | 4,000 labelled rolling-window samples used to train the risk model at start-up |
| `telemetry` | Live sensor readings, saved every 10 s while the backend runs |
| `recommendations`, `decisions` | Every recommendation shown and every operator decision (insert-only) |

The prototype has no login, so the backend uses the public (publishable/anon) key. Row Level Security allows
reads on every table and inserts only on the four log tables; nothing can be updated or deleted through the API.
Anyone who has the key can still insert rows, so add authentication before using this beyond a demo.

## Using the dashboard

1. The cell starts with a bearing fault developing on **CNC Mill 1**; its risk climbs over the first minutes.
2. Click any station to see its blast radius, telemetry and what is driving its score.
3. **Simulate options** compares A continue, B throttle, C controlled shutdown, D defer to the next break.
4. Enter your name and approve, reject or override (an override needs a reason). The decision is logged and
   applied to the virtual cell.
5. **Inject bearing fault** and **Drop sensors** let you test other stations and missing telemetry.
   **Reset virtual cell** starts over.

## Tests

```bash
cd backend
pytest
```

The tests cover the evaluation points in the roadmap: model accuracy on held-out data, simulation throughput
against the analytic value and replayability, blast-radius correctness, behaviour under missing telemetry,
and the approve / override / audit flow through the API.

## What is real and what is simulated

- There is no physical factory. The six-station cell, its sensors and the wear process are simulated.
- The risk model is trained on **synthetic** data generated from the same wear model, so its accuracy figures
  (AUC about 0.92) say the pipeline works, not how it would perform on a real plant.
- Costs, repair times and the worker-exposure index are illustrative assumptions, listed with every recommendation.
- One failure mode is modelled (bearing wear). Each station feeds one downstream station.
- Approved actions change the virtual cell only. Maintenance there takes about 40 seconds so a demo can show the full loop.

## Safety

SAFE-TWIN is a decision-support advisory tool. It does not control equipment and does not replace site
lockout/tagout (LOTO) procedures, certified safety controls or qualified personnel.

## Docker (optional)

```bash
docker compose up --build
```
