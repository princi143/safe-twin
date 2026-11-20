// Factory floor: 3D cell, live telemetry, risk, what-if comparison and the operator decision.
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  api, LEVEL_COLOR, PART_COLOR, pct,
  type AuditEntry, type Factory, type Health, type LiveMachine, type Recommendation, type RiskDetail, type Sample, type Trace, type User,
} from "../api";
import { DecisionPanel } from "../components/DecisionPanel";
import { FactoryGraph } from "../components/FactoryGraph";
import { TelemetryChart } from "../components/TelemetryChart";
import { Badge, Button, Card, Stat } from "../components/ui";

const Factory3D = lazy(() => import("../components/Factory3D"));

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
    { key: "DETECT", text: connected ? `${Object.keys(live).length} stations streaming` : "waiting for telemetry" },
    { key: "PREDICT", text: top ? `highest risk ${top.id} · ${pct(top.risk)}` : "—" },
    { key: "TRACE", text: trace ? `${trace.affected.length} downstream of ${trace.machine_id}` : "—" },
    { key: "SIMULATE", text: rec ? `${rec.payload.simulation.scenarios.length} options × ${rec.payload.simulation.replications} runs` : "not run yet" },
    { key: "DECIDE", text: rec ? `option ${rec.recommended_option} proposed for ${rec.machine_id}` : "awaiting simulation" },
  ];
  const parts = risk?.machine_id === selected && sel?.status !== "maintenance" ? risk.components : [];
  const firstStarve = trace?.affected.find((a) => a.starves_after_min !== null)?.starves_after_min;

  return (
    <div className="space-y-4">
      {error && <p className="rounded-md border border-high/40 bg-high/10 px-3 py-2 text-xs text-high" role="alert">{error}</p>}

      <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-5">
        {stages.map((s, i) => (
          <li key={s.key} className="bg-panel px-3 py-2">
            <div className="num text-[10px] font-semibold tracking-widest text-accent">{i + 1} · {s.key}</div>
            <div className="truncate text-xs text-muted">{s.text}</div>
          </li>
        ))}
      </ol>

      <Card title="Production cell" stage="TRACE"
        action={
          <div className="flex items-center gap-2">
            <div className="flex gap-1 rounded-md border border-line p-0.5">
              {(["3d", "graph"] as const).map((v) => (
                <button key={v} onClick={() => setView(v)}
                  className={`rounded px-2.5 py-1 text-[11px] font-semibold ${view === v ? "bg-raised text-text" : "text-muted hover:text-text"}`}>
                  {v === "3d" ? "3D floor" : "Dependency graph"}
                </button>
              ))}
            </div>
            <Button variant="ghost" onClick={reset}>Reset virtual cell</Button>
          </div>
        }>
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <div className="h-[430px] overflow-hidden rounded-md border border-line bg-ink">
            {view === "3d" ? (
              <Suspense fallback={<p className="p-6 text-xs text-muted">Loading the 3D floor…</p>}>
                <Factory3D factory={factory} live={live} selected={selected} trace={trace} onSelect={select} />
              </Suspense>
            ) : (
              <div className="p-3"><FactoryGraph factory={factory} live={live} selected={selected} trace={trace} onSelect={select} /></div>
            )}
          </div>
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Parts of {machine?.name ?? "the station"}</h3>
            {sel?.status === "maintenance" && <p className="mt-2 text-xs text-muted">The station is stopped for maintenance.</p>}
            <ul className="mt-2 space-y-2">
              {parts.map((c) => (
                <li key={c.key} className="rounded-md border px-3 py-2" style={{ borderColor: c.fault_location ? "#ef5b5b" : "#263242" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">{c.name}</span>
                    <Badge color={PART_COLOR[c.status]}>{c.fault_location ? "fault here" : c.status}</Badge>
                  </div>
                  <div className="num mt-1 text-[11px] text-muted">
                    {c.signal_label} {c.value ?? "—"} {c.unit} · healthy {c.healthy_value} {c.unit}
                  </div>
                  <div className="mt-1.5 h-1 rounded bg-line">
                    <div className="h-1 rounded" style={{ width: `${Math.min(100, (c.deviation ?? 0) * 100)}%`, background: PART_COLOR[c.status] }} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              Click a station to inspect it; drag to rotate, scroll to zoom. Coloured parts have moved away from their healthy reading.
              “Fault here” marks the part whose signals contribute most to the risk score.
            </p>
          </div>
        </div>
        {trace && machine && (
          <div className="mt-3 grid grid-cols-2 gap-4 border-t border-line pt-3 md:grid-cols-5">
            <Stat label="If this station stops" value={`−${trace.line_loss_pct}%`} hint={`line output ${trace.line_rate_baseline} → ${trace.line_rate_if_down} parts/h`} />
            <Stat label="Stations affected" value={trace.affected.length} hint={trace.affected.map((a) => a.id).join(", ") || "none downstream"} />
            <Stat label="First station starves" value={firstStarve != null ? `${firstStarve} min` : "—"} hint="with buffers half full" />
            <Stat label="Reroute available" value={trace.reroute_to.length ? trace.reroute_to.join(", ") : "none"} hint={trace.is_on_bottleneck ? "this stage is the line bottleneck" : `bottleneck: ${trace.bottleneck_stage.join(" + ")}`} />
            <Stat label="Workers in radius" value={trace.workers_in_radius} hint="at this and downstream stations" />
          </div>
        )}
      </Card>

      {machine && sel && (
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Card title={`${machine.name} · live telemetry`} stage="DETECT"
            action={
              <div className="flex gap-2">
                <Button onClick={() => act(() => api.injectFault(selected))}>Inject bearing fault</Button>
                <Button onClick={() => act(() => api.sensorDropout(selected, !sel.sensor_dropout))}>
                  {sel.sensor_dropout ? "Restore sensors" : "Drop sensors"}
                </Button>
              </div>
            }>
            <TelemetryChart samples={history[selected] ?? []} />
            <div className="mt-2 grid grid-cols-4 gap-4 border-t border-line pt-3">
              <Stat label="Vibration" value={sel.vibration?.toFixed(2) ?? "—"} hint="mm/s" />
              <Stat label="Temperature" value={sel.temperature?.toFixed(1) ?? "—"} hint="°C" />
              <Stat label="Motor current" value={sel.current?.toFixed(1) ?? "—"} hint="A" />
              <Stat label="Window complete" value={pct(sel.completeness)} hint={sel.stale ? "score held at last value" : "rolling window"} />
            </div>
          </Card>

          <Card title="Failure-risk score" stage="PREDICT" action={<Badge color={LEVEL_COLOR[sel.level]}>{sel.level}</Badge>}>
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="num text-5xl font-semibold leading-none" style={{ color: LEVEL_COLOR[sel.level] }}>
                  {sel.status === "maintenance" ? "—" : pct(sel.risk)}
                </div>
                <div className="mt-1 text-[11px] text-muted">chance of unplanned bearing failure in the next 8 h if nothing changes</div>
              </div>
              {health && (
                <div className="num text-right text-[11px] text-muted">
                  holdout AUC {health.model.auc}<br />Brier {health.model.brier}<br />{health.model.n_train} training windows
                </div>
              )}
            </div>
            {sel.stale && <p className="mt-3 rounded-md border border-watch/40 bg-watch/10 px-3 py-2 text-xs text-watch">Telemetry is missing. The score shown is the last known value, not a new estimate.</p>}
            <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">What is driving the score</h3>
            <div className="space-y-2">
              {(risk?.machine_id === selected && sel.status !== "maintenance" ? risk.drivers : []).map((d) => (
                <div key={d.feature} className="grid grid-cols-[150px_1fr_52px] items-center gap-2 text-xs">
                  <span title={`now ${d.value} ${d.unit}, healthy ${d.healthy_value} ${d.unit}`}>{d.label}</span>
                  <div className="h-1.5 rounded bg-line">
                    <div className="h-1.5 rounded" style={{ width: `${Math.min(100, Math.abs(d.contribution) * 100)}%`, background: d.contribution >= 0 ? "#ef5b5b" : "#3fb68b" }} />
                  </div>
                  <span className="num text-right">{d.contribution >= 0 ? "+" : "−"}{Math.abs(d.contribution * 100).toFixed(0)} pts</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted">Points = how much the risk would fall if that one input were at its healthy value.</p>
          </Card>
        </div>
      )}

      {machine && sel && (
        <Card title={`What-if comparison${rec ? ` · ${rec.payload.machine.name}` : ""}`} stage="SIMULATE · DECIDE"
          action={
            <Button variant="primary" disabled={simulating || sel.status === "maintenance"} onClick={simulate}>
              {simulating ? "Simulating…" : `Simulate options for ${machine.id}`}
            </Button>
          }>
          {rec ? (
            <DecisionPanel rec={rec} user={user} onDecided={() => api.audit().then(setAudit).catch(() => undefined)} />
          ) : (
            <p className="py-6 text-center text-xs text-muted">
              Run the simulation to compare continuing, throttling, a controlled shutdown and deferring to the next break for {machine.name}.
            </p>
          )}
        </Card>
      )}

      <Card title="Decision audit log" stage="AUDIT">
        {audit.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted">No decisions recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr className="text-left text-muted">
                  {["Time", "Station", "Risk", "Recommended", "Decision", "Chosen", "Decided by", "Note"].map((h) => (
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
                    <td className="num border-b border-line/60 py-2 pr-3">{a.recommended_option ?? "—"}</td>
                    <td className="border-b border-line/60 py-2 pr-3">
                      <Badge color={a.action === "approved" ? "#3fb68b" : a.action === "rejected" ? "#ef5b5b" : "#e2a93b"}>{a.action}</Badge>
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
