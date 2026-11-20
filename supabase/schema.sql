-- SAFE-TWIN schema (Supabase / Postgres)
-- Run this first, then seed.sql, in the Supabase SQL editor.

create table if not exists public.machines (
  id                   text primary key,
  name                 text not null,
  kind                 text not null,
  cycle_time_min       numeric not null,
  pos_x                integer not null default 0,
  pos_y                integer not null default 0,
  workers_nearby       integer not null default 1,
  planned_repair_min   numeric not null default 60,
  unplanned_repair_min numeric not null default 180
);

create table if not exists public.dependencies (
  id              bigint generated always as identity primary key,
  source          text not null references public.machines(id),
  target          text not null references public.machines(id),
  buffer_capacity integer not null default 10,
  unique (source, target)
);

create table if not exists public.telemetry (
  id          bigint generated always as identity primary key,
  machine_id  text not null references public.machines(id),
  ts          timestamptz not null default now(),
  vibration   numeric,
  temperature numeric,
  current     numeric
);
create index if not exists telemetry_machine_ts_idx on public.telemetry (machine_id, ts desc);

create table if not exists public.maintenance_logs (
  id           bigint generated always as identity primary key,
  machine_id   text not null references public.machines(id),
  performed_at timestamptz not null,
  kind         text not null check (kind in ('planned', 'unplanned')),
  duration_min numeric not null,
  notes        text
);
create index if not exists maintenance_logs_machine_idx on public.maintenance_logs (machine_id, performed_at desc);

create table if not exists public.work_orders (
  id         text primary key,
  product    text not null,
  quantity   integer not null,
  due_in_min integer not null,
  priority   text not null default 'normal'
);

-- Labelled rolling-window samples used to train the failure-risk model.
create table if not exists public.training_samples (
  id                    bigint generated always as identity primary key,
  vib_mean              numeric not null,
  vib_std               numeric not null,
  vib_slope             numeric not null,
  temp_mean             numeric not null,
  current_mean          numeric not null,
  hours_since_maint     numeric not null,
  failed_within_horizon boolean not null
);

create table if not exists public.recommendations (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  machine_id         text not null references public.machines(id),
  risk_score         numeric not null,
  confidence         numeric not null,
  recommended_option text not null,
  payload            jsonb not null
);
create index if not exists recommendations_created_idx on public.recommendations (created_at desc);

-- Append-only audit trail of what the human operator decided.
create table if not exists public.decisions (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  recommendation_id uuid not null references public.recommendations(id),
  operator          text not null,
  action            text not null check (action in ('approved', 'rejected', 'overridden')),
  chosen_option     text,
  note              text
);
create index if not exists decisions_created_idx on public.decisions (created_at desc);
create index if not exists decisions_recommendation_idx on public.decisions (recommendation_id);

-- Shift log: one row per sign-in and per sign-out (insert-only).
create table if not exists public.session_events (
  id         bigint generated always as identity primary key,
  session_id text not null,
  username   text not null,
  role       text not null check (role in ('operator', 'supervisor')),
  event      text not null check (event in ('login', 'logout')),
  at         timestamptz not null default now()
);
create index if not exists session_events_at_idx on public.session_events (at desc);

-- Row Level Security.
-- The prototype has no login, so the backend talks to Supabase with the public (anon) key.
-- Reference data is read-only; telemetry, recommendations and decisions are insert-only,
-- so nothing in the audit trail can be edited or deleted through the API.
alter table public.machines         enable row level security;
alter table public.dependencies     enable row level security;
alter table public.telemetry        enable row level security;
alter table public.maintenance_logs enable row level security;
alter table public.work_orders      enable row level security;
alter table public.training_samples enable row level security;
alter table public.recommendations  enable row level security;
alter table public.decisions        enable row level security;
alter table public.session_events   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['machines','dependencies','telemetry','maintenance_logs',
                           'work_orders','training_samples','recommendations','decisions','session_events']
  loop
    execute format('drop policy if exists "read %1$s" on public.%1$I', t);
    execute format('create policy "read %1$s" on public.%1$I for select to anon, authenticated using (true)', t);
  end loop;
  foreach t in array array['telemetry','maintenance_logs','recommendations','decisions','session_events']
  loop
    execute format('drop policy if exists "insert %1$s" on public.%1$I', t);
    execute format('create policy "insert %1$s" on public.%1$I for insert to anon, authenticated with check (true)', t);
  end loop;
end $$;
