// Typed client for the SAFE-TWIN backend. Calls go through the Vite dev proxy (/api, /ws).

export type Level = "normal" | "watch" | "high" | "maintenance";
export type OptionKey = "A" | "B" | "C" | "D";

export interface Machine {
  id: string;
  name: string;
  kind: string;
  cycle_time_min: number;
  pos_x: number;
  pos_y: number;
  workers_nearby: number;
}
export interface Dependency { source: string; target: string; buffer_capacity: number }
export interface WorkOrder { id: string; product: string; quantity: number; due_in_min: number; priority: string }
export interface Factory { machines: Machine[]; dependencies: Dependency[]; work_orders: WorkOrder[] }

export interface Health {
  store: "supabase" | "memory";
  store_note: string;
  advisory: string;
  model: { algorithm: string; training_source: string; n_train: number; n_test: number; auc: number; brier: number };
}

export type Role = "operator" | "supervisor";
export interface User { username: string; role: Role }
export interface ComponentState {
  key: "bearing" | "motor" | "housing"; name: string; signal_label: string; unit: string;
  value: number | null; healthy_value: number; deviation: number | null;
  status: "normal" | "watch" | "fault" | "unknown"; contribution: number; fault_location: boolean;
}

export interface LiveMachine {
  id: string;
  status: "running" | "throttled" | "maintenance";
  risk: number;
  level: Level;
  stale: boolean;
  completeness: number;
  sensor_dropout: boolean;
  maintenance_pending: boolean;
  components: ComponentState[];
  vibration: number | null;
  temperature: number | null;
  current: number | null;
  ts: string;
}
export interface Snapshot { ts: string; machines: LiveMachine[] }
export interface Sample { ts: string; vibration: number | null; temperature: number | null; current: number | null; risk: number }

export interface Driver { feature: string; label: string; unit: string; value: number; healthy_value: number; contribution: number }
export interface RiskDetail { machine_id: string; score: number; stale: boolean; telemetry_completeness: number; drivers: Driver[]; components: ComponentState[] }

export interface Affected {
  id: string; name: string; hops: number; baseline_rate: number; rate_if_down: number;
  throughput_loss_pct: number; starves_after_min: number | null; workers_nearby: number;
}
export interface Trace {
  machine_id: string; affected: Affected[]; affected_ids: string[]; edges: [string, string][];
  reroute_to: string[]; line_rate_baseline: number; line_rate_if_down: number; line_loss_pct: number;
  bottleneck_stage: string[]; is_on_bottleneck: boolean; workers_in_radius: number;
}

export interface Scenario {
  key: OptionKey; name: string; description: string;
  unplanned_failure_probability: number;
  throughput_units: number; throughput_p05: number; throughput_p95: number;
  throughput_loss_units: number; throughput_loss_pct: number;
  downtime_min: number; planned_downtime_min: number; unplanned_downtime_min: number;
  downstream_starved_min: number; bottleneck_station: string;
  worker_exposure_index: number; estimated_cost: number;
  orders: { id: string; product: string; due_in_min: number; on_time_probability: number }[];
  orders_at_risk: number; score: number; blocked_by_safety_gate: boolean;
}
export interface Recommendation {
  id: string; created_at: string; machine_id: string; risk_score: number; confidence: number;
  recommended_option: OptionKey;
  payload: {
    machine: { id: string; name: string };
    risk: { score: number; stale: boolean; drivers: Driver[] };
    trace: Trace;
    simulation: SimulationResult;
    recommended_option: OptionKey; recommended_name: string;
    reasons: string[]; trade_offs: string[]; assumptions: string[];
    confidence: { value: number; label: "low" | "medium" | "high"; parts: Record<string, number>; formula: string };
    advisory: string;
  };
}
export interface SimulationResult {
  horizon_min: number; replications: number; seed: number; baseline_throughput_units: number;
  scenarios: Scenario[]; weights: Record<string, number>; recommended: OptionKey;
}
export interface WhatIfResult extends SimulationResult {
  circumstances: { risk: number; risk_source: string; workers_nearby: number; reroute_available: boolean };
}
export interface LoadCheck {
  machine_id: string; risk_score: number; risk_source: string; load_pct: number; hours: number;
  failure_probability: number; failure_probability_nominal: number; hazard_multiplier: number;
  verdict: "yes" | "caution" | "no"; verdict_text: string; max_safe_load_pct: number | null;
  station_rate: number; line_rate: number; line_rate_nominal: number; assumptions: string[];
}
export interface SessionRow {
  session_id: string; username: string; role: Role; login_at: string | null; logout_at: string | null; duration_min: number | null;
}
export interface Overview {
  stations: {
    id: string; name: string; status: string; risk: number; stale: boolean; fault_component: string | null;
    can_take_full_load: "yes" | "caution" | "no"; max_safe_load_pct: number | null; hours_since_maintenance: number | null;
  }[];
  recommendations: {
    id: string; created_at: string; machine_id: string; risk_score: number; recommended_option: OptionKey;
    decision: string | null; decided_by: string | null;
  }[];
  sessions: SessionRow[];
}

export interface AuditEntry {
  id: string; created_at: string; recommendation_id: string; operator: string;
  action: "approved" | "rejected" | "overridden"; chosen_option: OptionKey | null; note: string | null;
  machine_id: string | null; risk_score: number | null; confidence: number | null; recommended_option: OptionKey | null;
}

// Local development leaves VITE_API_URL unset and uses the Vite proxy. A hosted frontend sets it
// to the backend's public address, e.g. https://safe-twin-api.onrender.com
const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

// The sign-in token is kept for this browser tab only.
let token = "";
let onSignedOut: () => void = () => undefined;
try { token = sessionStorage.getItem("safe-twin-token") ?? ""; } catch { /* storage unavailable */ }
export function setToken(value: string) {
  token = value;
  try { value ? sessionStorage.setItem("safe-twin-token", value) : sessionStorage.removeItem("safe-twin-token"); } catch { /* storage unavailable */ }
}
export const hasToken = () => token !== "";
export const onSessionExpired = (fn: () => void) => { onSignedOut = fn; };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { headers, ...init });
  if (res.status === 401 && token && !path.startsWith("/api/auth/login")) {
    setToken("");
    onSignedOut();
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail.map((d: { msg: string }) => d.msg).join("; ");
    } catch { /* keep the status text */ }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}
const post = <T,>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  health: () => request<Health>("/api/health"),
  factory: () => request<Factory>("/api/factory"),
  telemetry: (id: string) => request<Sample[]>(`/api/machines/${id}/telemetry?limit=150`),
  risk: (id: string) => request<RiskDetail>(`/api/machines/${id}/risk`),
  trace: (id: string) => request<Trace>(`/api/trace/${id}`),
  simulate: (machine_id: string) => post<Recommendation>("/api/simulate", { machine_id }),
  login: (username: string, password: string) => post<{ token: string; user: User }>("/api/auth/login", { username, password }),
  logout: () => post<{ ok: boolean }>("/api/auth/logout", {}),
  me: () => request<User>("/api/auth/me"),
  overview: () => request<Overview>("/api/supervisor/overview"),
  loadCheck: (body: { machine_id: string; load_pct: number; hours: number; risk_override: number | null }) =>
    post<LoadCheck>("/api/supervisor/load-check", body),
  whatIf: (body: { machine_id: string; risk: number | null; workers_nearby: number | null; reroute_available: boolean }) =>
    post<WhatIfResult>("/api/supervisor/what-if", body),
  decide: (recId: string, body: { action: string; chosen_option?: OptionKey; note: string }) =>
    post<AuditEntry & { effect: string }>(`/api/recommendations/${recId}/decision`, body),
  audit: () => request<AuditEntry[]>("/api/audit"),
  injectFault: (machine_id: string) => post("/api/demo/inject-fault", { machine_id }),
  sensorDropout: (machine_id: string, enabled: boolean) => post("/api/demo/sensor-dropout", { machine_id, enabled }),
  reset: () => post("/api/demo/reset", {}),
};

export function connectLive(onSnapshot: (s: Snapshot) => void, onStatus: (connected: boolean) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    const origin = BASE || location.origin;
    ws = new WebSocket(`${origin.replace(/^http/, "ws")}/ws`);
    ws.onopen = () => onStatus(true);
    ws.onmessage = (e) => onSnapshot(JSON.parse(e.data));
    ws.onclose = () => {
      onStatus(false);
      if (!closed) timer = setTimeout(open, 2000); // retry until the backend is back
    };
  };
  open();
  return () => {
    closed = true;
    clearTimeout(timer);
    ws?.close();
  };
}

export const LEVEL_COLOR: Record<Level, string> = {
  normal: "#3fb68b", watch: "#e2a93b", high: "#ef5b5b", maintenance: "#4cc2d6",
};
export const PART_COLOR = { normal: "#3fb68b", watch: "#e2a93b", fault: "#ef5b5b", unknown: "#8496ab" } as const;
export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
export const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
