// Factory floor: 3D cell, live telemetry, risk, what-if comparison and the operator decision.
import {
  Activity, AlertTriangle, Box, CircleDot, ClipboardList, Cog, Gauge as GaugeIcon, GitBranch, Radio, RotateCcw, Scale,
  Shuffle, Thermometer, Timer, TrendingDown, Users, WifiOff, Zap,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  api, LEVEL_COLOR, PART_COLOR, pct,
  type AuditEntry, type Factory, type Health, type LiveMachine, type Recommendation, type RiskDetail, type Sample, type Trace, type User,
} from "../api";
import { DecisionPanel } from "../components/DecisionPanel";
import { FactoryGraph } from "../components/FactoryGraph";
import { TelemetryChart } from "../components/TelemetryChart";
import { Badge, Button, Card, Gauge, Stat } from "../components/ui";

const Factory3D = lazy(() => import("../components/Factory3D"));
const PART_ICON = { bearing: CircleDot, motor: Zap, housing: Thermometer } as const;

export function OperatorPage({ user, health, factory, live, history, connected, onReset }: {
  user: User; health: Health | null; factory: Factory; live: Record<string, LiveMachine>;
  history: Record<string, Sample[]>; connected: boolean; onReset: () => void;
}) {
  const [selected, setSelected] = useState("");
  const [view, setView] = useState<"3d" | "graph">("3d");
  const [risk, setRisk] = useState<RiskDetail | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { api.audit().then(setAudit).catch(() => undefined); }, []);

  // Start on the riskiest station.
  const ranked = useMemo(() => Object.values(live).filter((m) => m.status !== "maintenance").sort((a, b) => b.risk - a.risk), [live]);
  useEffect(() => { if (!selected && ranked.length) setSelected(ranked[0].id); }, [selected, ranked]);

  useEffect(() => {
    if (!selected) return;
    setTrace(null);
    api.trace(selected).then(setTrace).catch(() => undefined);
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    let stop = false;
    const load = () => api.risk(selected).then((r) => { if (!stop) setRisk(r); }).catch(() => undefined);
    load();
    const t = setInterval(load, 4000);
    return () => { stop = true; clearInterval(t); };
  }, [selected]);

  const machine = factory.machines.find((m) => m.id === selected);
  const sel = live[selected];
  const select = (id: string) => { setSelected(id); setRisk(null); };

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); setError(""); } catch (e) { setError((e as Error).message); }
  };
  const simulate = async () => {
    setSimulating(true);
    await act(async () => setRec(await api.simulate(selected)));
    setSimulating(false);
  };
  const reset = () => act(async () => { await api.reset(); setRec(null); onReset(); });

  const top = ranked[0];
  const stages = [
    { key: "Detect", icon: Radio, text: connected ? `${Object.keys(live).length} stations live` : "waiting" },
    { key: "Predict", icon: GaugeIcon, text: top ? `${top.id} · ${pct(top.risk)}` : "—" },
    { key: "Trace", icon: GitBranch, text: trace ? `${trace.affected.length} downstream` : "—" },
    { key: "Simulate", icon: Shuffle, text: rec ? `${rec.payload.simulation.scenarios.length} options` : "not run" },
    { key: "Decide", icon: Scale, text: rec ? `option ${rec.recommended_option}` : "waiting" },
  ];
  const parts = sel && sel.status !== "maintenance" ? sel.components : [];
  const firstStarve = trace?.affected.find((a) => a.starves_after_min !== null)?.starves_after_min;

  return (
    <div className="space-y-4">
      {error && <p className="rounded-xl bg-high/10 px-4 py-2 text-xs text-high" role="alert">{error}</p>}

      <ol className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {stages.map((s) => (
          <li key={s.key} className="flex items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-white"><s.icon size={18} /></span>
            <div className="min-w-0">
              <div className="text-xs font-semibold">{s.key}</div>
              <div className="num truncate text-[11px] text-muted">{s.text}</div>
            </div>
          </li>
        ))}
      </ol>

      <Card title="Production cell" icon={<Box size={16} />}
        action={
          <div className="flex items-center gap-2">
            <div className="flex gap-1 rounded-lg bg-raised p-0.5">
              {(["3d", "graph"] as const).map((v) => (
                <button key={v} onClick={() => setView(v)}
                  className={`rounded-md px-3 py-1 text-[11px] font-semibold ${view === v ? "bg-panel text-brand shadow-sm" : "text-muted"}`}>
                  {v === "3d" ? "3D" : "Graph"}
                </button>
              ))}
            </div>
            <Button variant="ghost" onClick={reset} title="Reset the virtual cell"><RotateCcw size={14} />Reset</Button>
          </div>
        }>
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="h-[500px] overflow-hidden rounded-2xl bg-gradient-to-b from-[#EFE3F3] to-[#DCC8E3]">
            {view === "3d" ? (
              <Suspense fallback={<p className="p-6 text-xs text-muted">Loading…</p>}>
                <Factory3D factory={factory} live={live} selected={selected} trace={trace} onSelect={select} />
              </Suspense>
            ) : (
              <div className="p-3 pt-16"><FactoryGraph factory={factory} live={live} selected={selected} trace={trace} onSelect={select} /></div>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-2xl bg-raised p-3">
              <Gauge value={sel?.status === "maintenance" ? 0 : sel?.risk ?? 0} color={LEVEL_COLOR[sel?.level ?? "normal"]} size={84}
                text={sel?.status === "maintenance" ? "—" : undefined} />
              <div>
                <div className="text-sm font-semibold">{machine?.name ?? "—"}</div>
                <Badge color={LEVEL_COLOR[sel?.level ?? "normal"]}>{sel?.level ?? "…"}</Badge>
              </div>
            </div>
            {parts.map((c) => {
              const Icon = PART_ICON[c.key];
              return (
                <div key={c.key} className="rounded-2xl border p-3" style={{ borderColor: c.fault_location ? PART_COLOR.fault : "#DCC8E3" }}>
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: PART_COLOR[c.status] }}><Icon size={16} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold">{c.name}</div>
                      <div className="num text-[11px] text-muted">{c.value ?? "—"} {c.unit}</div>
                    </div>
                    {c.fault_location && <AlertTriangle size={16} className="text-high" aria-label="Fault here" />}
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-raised">
                    <div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, (c.deviation ?? 0) * 100)}%`, background: PART_COLOR[c.status] }} />
                  </div>
                </div>
              );
            })}
            {sel?.status === "maintenance" && <p className="rounded-2xl bg-raised p-3 text-xs text-muted">In maintenance</p>}
          </div>
        </div>
        {trace && machine && (
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-5">
            <Stat icon={<TrendingDown size={16} />} label="line output if it stops" value={`−${trace.line_loss_pct}%`} />
            <Stat icon={<GitBranch size={16} />} label="stations affected" value={trace.affected.length} />
            <Stat icon={<Timer size={16} />} label="until next station starves" value={firstStarve != null ? `${firstStarve} min` : "—"} />
            <Stat icon={<Shuffle size={16} />} label="reroute to" value={trace.reroute_to.length ? trace.reroute_to.join(", ") : "none"} />
            <Stat icon={<Users size={16} />} label="workers in radius" value={trace.workers_in_radius} />
          </div>
        )}
      </Card>

      {machine && sel && (
        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <Card title={machine.name} icon={<Activity size={16} />}
            action={
              <div className="flex gap-2">
                <Button onClick={() => act(() => api.injectFault(selected))}><AlertTriangle size={14} />Inject fault</Button>
                <Button onClick={() => act(() => api.sensorDropout(selected, !sel.sensor_dropout))}>
                  <WifiOff size={14} />{sel.sensor_dropout ? "Restore sensors" : "Drop sensors"}
                </Button>
              </div>
            }>
            <TelemetryChart samples={history[selected] ?? []} />
            {sel.stale && <p className="mt-2 rounded-xl bg-watch/10 px-3 py-2 text-xs text-watch">Sensors missing. Risk is held at the last value.</p>}
          </Card>

          <Card title="What drives the risk" icon={<Cog size={16} />}
            action={health && <span className="num text-[11px] text-muted" title="Accuracy of the risk model on held-out data">AUC {health.model.auc}</span>}>
            <div className="space-y-3">
              {(risk?.machine_id === selected && sel.status !== "maintenance" ? risk.drivers : []).map((d) => (
                <div key={d.feature} title={`now ${d.value} ${d.unit} · healthy ${d.healthy_value} ${d.unit}`}>
                  <div className="flex justify-between text-xs">
                    <span>{d.label}</span>
                    <span className="num text-muted">{d.contribution >= 0 ? "+" : "−"}{Math.abs(d.contribution * 100).toFixed(0)}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-raised">
                    <div className="h-2 rounded-full" style={{ width: `${Math.min(100, Math.abs(d.contribution) * 100)}%`, background: d.contribution >= 0 ? "#D64545" : "#2E9B74" }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {machine && sel && (
        <Card title={rec ? `Options · ${rec.payload.machine.name}` : "Options"} icon={<Shuffle size={16} />}
          action={
            <Button variant="primary" disabled={simulating || sel.status === "maintenance"} onClick={simulate}>
              <Shuffle size={14} />{simulating ? "Simulating…" : `Simulate ${machine.id}`}
            </Button>
          }>
          {rec ? (
            <DecisionPanel rec={rec} user={user} onDecided={() => api.audit().then(setAudit).catch(() => undefined)} />
          ) : (
            <div className="flex flex-col items-center gap-2 py-8 text-muted">
              <Shuffle size={28} />
              <p className="text-xs">Simulate to compare four responses</p>
            </div>
          )}
        </Card>
      )}

      <Card title="Decisions" icon={<ClipboardList size={16} />}>
        {audit.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted">None yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="text-left text-muted">
                  {["Time", "Station", "Risk", "Decision", "Option", "By", "Note"].map((h) => (
                    <th key={h} className="border-b border-line pb-2 pr-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="num border-b border-line/60 py-2 pr-3">{new Date(a.created_at).toLocaleString()}</td>
                    <td className="border-b border-line/60 py-2 pr-3">{a.machine_id ?? "—"}</td>
                    <td className="num border-b border-line/60 py-2 pr-3">{a.risk_score != null ? pct(Number(a.risk_score)) : "—"}</td>
                    <td className="border-b border-line/60 py-2 pr-3">
                      <Badge color={a.action === "approved" ? "#2E9B74" : a.action === "rejected" ? "#D64545" : "#C4871B"}>{a.action}</Badge>
                    </td>
                    <td className="num border-b border-line/60 py-2 pr-3">{a.chosen_option ?? "—"}</td>
                    <td className="border-b border-line/60 py-2 pr-3">{a.operator}</td>
                    <td className="border-b border-line/60 py-2 text-muted">{a.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
