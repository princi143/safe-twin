"""Built-in copy of supabase/seed.sql, used when Supabase is not configured or unreachable."""
from datetime import datetime, timedelta, timezone

MACHINES = [
    dict(id="CNC-1", name="CNC Mill 1", kind="cnc", cycle_time_min=3.0, pos_x=0, pos_y=0,
         workers_nearby=2, planned_repair_min=60, unplanned_repair_min=200),
    dict(id="CNC-2", name="CNC Mill 2", kind="cnc", cycle_time_min=3.0, pos_x=0, pos_y=180,
         workers_nearby=2, planned_repair_min=60, unplanned_repair_min=200),
    dict(id="DEBURR", name="Deburring", kind="deburr", cycle_time_min=1.3, pos_x=280, pos_y=90,
         workers_nearby=1, planned_repair_min=45, unplanned_repair_min=150),
    dict(id="WASH", name="Parts Washer", kind="wash", cycle_time_min=1.2, pos_x=540, pos_y=90,
         workers_nearby=1, planned_repair_min=40, unplanned_repair_min=120),
    dict(id="ASSEMBLY", name="Assembly Robot", kind="assembly", cycle_time_min=1.4, pos_x=800, pos_y=90,
         workers_nearby=3, planned_repair_min=75, unplanned_repair_min=240),
    dict(id="INSPECT", name="Vision Inspect", kind="inspect", cycle_time_min=1.0, pos_x=1060, pos_y=90,
         workers_nearby=1, planned_repair_min=30, unplanned_repair_min=90),
]

DEPENDENCIES = [
    dict(source="CNC-1", target="DEBURR", buffer_capacity=8),
    dict(source="CNC-2", target="DEBURR", buffer_capacity=8),
    dict(source="DEBURR", target="WASH", buffer_capacity=6),
    dict(source="WASH", target="ASSEMBLY", buffer_capacity=10),
    dict(source="ASSEMBLY", target="INSPECT", buffer_capacity=6),
]

WORK_ORDERS = [
    dict(id="WO-1041", product="Pump housing A", quantity=90, due_in_min=180, priority="high"),
    dict(id="WO-1042", product="Pump housing B", quantity=110, due_in_min=360, priority="normal"),
    dict(id="WO-1043", product="Valve body C", quantity=80, due_in_min=480, priority="normal"),
]

_HOURS_SINCE = {"CNC-1": 410, "CNC-2": 96, "DEBURR": 150, "WASH": 220, "ASSEMBLY": 130, "INSPECT": 60}


def maintenance_logs() -> list[dict]:
    now = datetime.now(timezone.utc)
    return [
        dict(machine_id=m, performed_at=(now - timedelta(hours=h)).isoformat(), kind="planned",
             duration_min=60, notes="Seeded preventive maintenance")
        for m, h in _HOURS_SINCE.items()
    ]
