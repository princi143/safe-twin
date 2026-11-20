-- SAFE-TWIN seed data: one virtual production cell with six stations.
-- All of this is synthetic demo data, not measurements from a real plant.

insert into public.machines (id, name, kind, cycle_time_min, pos_x, pos_y, workers_nearby, planned_repair_min, unplanned_repair_min) values
  ('CNC-1',    'CNC Mill 1',      'cnc',      3.0,   0,   0, 2, 60, 200),
  ('CNC-2',    'CNC Mill 2',      'cnc',      3.0,   0, 180, 2, 60, 200),
  ('DEBURR',   'Deburring',       'deburr',   1.3, 280,  90, 1, 45, 150),
  ('WASH',     'Parts Washer',    'wash',     1.2, 540,  90, 1, 40, 120),
  ('ASSEMBLY', 'Assembly Robot',  'assembly', 1.4, 800,  90, 3, 75, 240),
  ('INSPECT',  'Vision Inspect',  'inspect',  1.0, 1060, 90, 1, 30, 90)
on conflict (id) do nothing;

insert into public.dependencies (source, target, buffer_capacity) values
  ('CNC-1',    'DEBURR',   8),
  ('CNC-2',    'DEBURR',   8),
  ('DEBURR',   'WASH',     6),
  ('WASH',     'ASSEMBLY', 10),
  ('ASSEMBLY', 'INSPECT',  6)
on conflict (source, target) do nothing;

insert into public.work_orders (id, product, quantity, due_in_min, priority) values
  ('WO-1041', 'Pump housing A',  90, 180, 'high'),
  ('WO-1042', 'Pump housing B', 110, 360, 'normal'),
  ('WO-1043', 'Valve body C',    80, 480, 'normal')
on conflict (id) do nothing;

insert into public.maintenance_logs (machine_id, performed_at, kind, duration_min, notes)
select * from (values
  ('CNC-1',    now() - interval '410 hours', 'planned',    55, 'Spindle bearing inspection, lubrication'),
  ('CNC-1',    now() - interval '1300 hours','unplanned', 210, 'Spindle bearing seizure, bearing replaced'),
  ('CNC-2',    now() - interval '96 hours',  'planned',    60, 'Spindle bearing replaced (preventive)'),
  ('DEBURR',   now() - interval '150 hours', 'planned',    40, 'Brush head replaced'),
  ('WASH',     now() - interval '220 hours', 'planned',    35, 'Pump seal and filter change'),
  ('ASSEMBLY', now() - interval '130 hours', 'planned',    70, 'Axis 3 gearbox service'),
  ('INSPECT',  now() - interval '60 hours',  'planned',    25, 'Camera calibration')
) as v(machine_id, performed_at, kind, duration_min, notes)
where not exists (select 1 from public.maintenance_logs);

-- 4000 labelled rolling-window samples for the bearing-wear failure mode.
-- "wear" is the hidden bearing condition (0 = new, 1 = failed); sensors respond to it with noise.
-- The same generative model is implemented in backend/app/risk.py (synthetic_training_set).
insert into public.training_samples
  (vib_mean, vib_std, vib_slope, temp_mean, current_mean, hours_since_maint, failed_within_horizon)
select
  round((2.0 + 6.0 * wear * wear + random_normal(0, 0.25))::numeric, 4),
  round(greatest(0.05, 0.15 + 0.5 * wear + random_normal(0, 0.05))::numeric, 4),
  round((12.0 * wear * rate + random_normal(0, 0.008))::numeric, 5),
  round((55.0 + 25.0 * wear + random_normal(0, 1.5))::numeric, 3),
  round((12.0 + 3.0 * wear + random_normal(0, 0.4))::numeric, 3),
  round((20.0 + 600.0 * wear * (0.5 + u2))::numeric, 1),
  u3 < 1.0 / (1.0 + exp(-9.0 * (wear + 40.0 * rate - 0.62)))
from (
  select power(random(), 1.3) as wear,
         case when random() < 0.3 then 0.001 + 0.004 * random() else 0 end as rate,
         random() as u2,
         random() as u3
  from generate_series(1, 4000)
) s
where not exists (select 1 from public.training_samples);
