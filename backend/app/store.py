"""Data access. SupabaseStore talks to Supabase's REST API; MemoryStore is the offline fallback."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

import httpx

from . import seed_data

log = logging.getLogger("safe-twin.store")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class MemoryStore:
    name = "memory"

    def __init__(self) -> None:
        self._maintenance = seed_data.maintenance_logs()
        self._recommendations: list[dict] = []
        self._decisions: list[dict] = []
        self._session_events: list[dict] = []
        self.telemetry_rows = 0

    def machines(self): return [dict(m) for m in seed_data.MACHINES]
    def dependencies(self): return [dict(d) for d in seed_data.DEPENDENCIES]
    def work_orders(self): return [dict(w) for w in seed_data.WORK_ORDERS]
    def maintenance_logs(self): return list(self._maintenance)
    def training_samples(self): return []  # caller falls back to the synthetic generator

    def insert_telemetry(self, rows: list[dict]) -> None:
        self.telemetry_rows += len(rows)

    def insert_maintenance(self, row: dict) -> None:
        self._maintenance.append(row)

    def insert_recommendation(self, rec: dict) -> dict:
        rec = {"id": str(uuid.uuid4()), "created_at": _now(), **rec}
        self._recommendations.insert(0, rec)
        return rec

    def get_recommendation(self, rec_id: str) -> dict | None:
        return next((r for r in self._recommendations if r["id"] == rec_id), None)

    def list_recommendations(self, limit: int = 20) -> list[dict]:
        return self._recommendations[:limit]

    def insert_decision(self, dec: dict) -> dict:
        dec = {"id": str(uuid.uuid4()), "created_at": _now(), **dec}
        self._decisions.insert(0, dec)
        return dec

    def list_decisions(self, limit: int = 50) -> list[dict]:
        return self._decisions[:limit]

    def insert_session_event(self, ev: dict) -> dict:
        ev = {"at": _now(), **ev}
        self._session_events.insert(0, ev)
        return ev

    def list_session_events(self, limit: int = 200) -> list[dict]:
        return self._session_events[:limit]


class SupabaseStore:
    name = "supabase"

    def __init__(self, url: str, key: str) -> None:
        self._http = httpx.Client(
            base_url=f"{url}/rest/v1",
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=15,
        )

    def _get(self, table: str, **params) -> list[dict]:
        r = self._http.get(f"/{table}", params={"select": "*", **params})
        r.raise_for_status()
        return r.json()

    def _insert(self, table: str, rows, returning: bool = False):
        headers = {"Prefer": "return=representation" if returning else "return=minimal"}
        r = self._http.post(f"/{table}", json=rows, headers=headers)
        r.raise_for_status()
        return r.json() if returning else None

    def machines(self): return self._get("machines", order="pos_x.asc,pos_y.asc")
    def dependencies(self): return self._get("dependencies", order="id.asc")
    def work_orders(self): return self._get("work_orders", order="due_in_min.asc")
    def maintenance_logs(self): return self._get("maintenance_logs", order="performed_at.desc")

    def training_samples(self) -> list[dict]:
        # Supabase returns at most 1000 rows per request, so page through the table.
        rows, page = [], 1000
        while True:
            chunk = self._get("training_samples", order="id.asc", limit=page, offset=len(rows))
            rows.extend(chunk)
            if len(chunk) < page:
                return rows

    def insert_telemetry(self, rows: list[dict]) -> None:
        self._insert("telemetry", rows)

    def insert_maintenance(self, row: dict) -> None:
        self._insert("maintenance_logs", row)

    def insert_recommendation(self, rec: dict) -> dict:
        return self._insert("recommendations", rec, returning=True)[0]

    def get_recommendation(self, rec_id: str) -> dict | None:
        rows = self._get("recommendations", id=f"eq.{rec_id}")
        return rows[0] if rows else None

    def list_recommendations(self, limit: int = 20) -> list[dict]:
        return self._get("recommendations", order="created_at.desc", limit=limit)

    def insert_decision(self, dec: dict) -> dict:
        return self._insert("decisions", dec, returning=True)[0]

    def list_decisions(self, limit: int = 50) -> list[dict]:
        return self._get("decisions", order="created_at.desc", limit=limit)

    def insert_session_event(self, ev: dict) -> dict:
        return self._insert("session_events", ev, returning=True)[0]

    def list_session_events(self, limit: int = 200) -> list[dict]:
        return self._get("session_events", order="at.desc", limit=limit)


def make_store(url: str, key: str):
    """Return (store, note). Falls back to the in-memory store if Supabase can't be used."""
    if not url or not key:
        return MemoryStore(), "SUPABASE_URL / SUPABASE_KEY not set - using built-in demo data (nothing is saved)."
    try:
        store = SupabaseStore(url, key)
        if not store.machines():
            raise RuntimeError("the machines table is empty - run supabase/schema.sql and supabase/seed.sql")
        return store, "Connected to Supabase."
    except Exception as exc:  # noqa: BLE001 - any failure means we run offline
        log.warning("Supabase unavailable (%s); falling back to in-memory data", exc)
        return MemoryStore(), f"Supabase unavailable ({exc}) - using built-in demo data (nothing is saved)."
