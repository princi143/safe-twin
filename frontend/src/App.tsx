import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api, connectLive, LEVEL_COLOR, pct,
  type AuditEntry, type Factory, type Health, type LiveMachine, type Recommendation,
  type RiskDetail, type Sample, type Trace,
} from "./api";
import { DecisionPanel } from "./components/DecisionPanel";
import { FactoryGraph } from "./components/FactoryGraph";
import { TelemetryChart } from "./components/TelemetryChart";
import { Badge, Button, Card, Stat } from "./components/ui";

const MAX_SAMPLES = 150;

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [factory, setFactory] = useState<Factory | null>(null);
  const [live, setLive] = useState<Record<string, LiveMachine>>({});
  const [history, setHistory] = useState<Record<string, Sample[]>>({});
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState("");
  const [risk, setRisk] = useState<RiskDetail | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState("");

  const loadHistory = useCallback(async (machines: { id: string }[]) => {
    const all = await Promise.all(machines.map((m) => api.telemetry(m.id)));
    setHistory(Object.fromEntries(machines.map((m, i) => [m.id, all[i]])));
  }, []);

  // Initial load, retried until the backend answers.
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const [h, f, a] = await Promise.all([api.health(), api.factory(), api.audit()]);
        if (stop) return;
        setHealth(h); setFactory(f); setAudit(a); setError("");
        await loadHistory(f.machines);
      } catch {
        if (stop) return;
        setError("Can't reach the SAFE-TWIN backend yet. If it is starting or waking up, this page will connect by itself.");
        setTimeout(load, 3000);
      }
    };
    load();
    return () => { stop = true; };
  }, [loadHistory]);

  // Live telemetry stream.
  useEffect(() => connectLive((snap) => {
    setLive(Object.fromEntries(snap.machines.map((m) => [m.id, m])));
    setHistory((prev) => {
      const next = { ...prev };
      for (const m of snap.machines) {
        const list = prev[m.id] ?? [];
        if (list.length && list[list.length - 1].ts === m.ts) continue;
        next[m.id] = [...list, { ts: m.ts, vibration: m.vibration, temperature: m.temperature, current: m.current, risk: m.risk }].slice(-MAX_SAMPLES);
      }
      return next;
    });
  }, setConnected), []);

  // Select the riskiest station once data arrives.
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

  const machine = factory?.machines.find((m) => m.id === selected);
  const sel = live[selected];

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); setError(""); } catch (e) { setError((e as Error).message); }
  };
  const simulate = async () => {
    setSimulating(true);
    await act(async () => setRec(await api.simulate(selected)));
    setSimulating(false);
  };
  const reset = () => act(async () => {
    await api.reset();
    setRec(null);
    if (factory) await loadHistory(factory.machines);
  });

  const top = ranked[0];
  const stages = [
    { key: "DETECT", text: connected ? `${Object.keys(live).length} stations streaming` : "waiting for telemetry" },
    { key: "PREDICT", text: top ? `highest risk ${top.id} · ${pct(top.risk)}` : "—" },
    { key: "TRACE", text: trace ? `${trace.affected.length} downstream of ${trace.machine_id}` : "—" },
    { key: "SIMULATE", text: rec ? `${rec.payload.simulation.scenarios.length} options × ${rec.payload.simulation.replications} runs` : "not run yet" },
    { key: "DECIDE", text: rec ? `option ${rec.recommended_option} proposed for ${rec.machine_id}` : "awaiting simulation" },
  ];

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 p-4 lg:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">SAFE-TWIN</h1>
          <p className="text-xs text-muted">Factory-level failure impact and human-in-the-loop decision support · virtual production cell</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge color={connected ? "#3fb68b" : "#ef5b5b"}>{connected ? "live" : "offline"}</Badge>
          {health && (
            <span title={health.store_note}>
              <Badge color={health.store === "supabase" ? "#3fb68b" : "#e2a93b"}>
                {health.store === "supabase" ? "Supabase connected" : "demo data · not saved"}
              </Badge>
            </span>
          )}
          <Button variant="ghost" onClick={reset}>Reset virtual cell</Button>
        </div>
      </header>

      {error && <p className="rounded-md border border-high/40 bg-high/10 px-3 py-2 text-xs text-high" role="alert">{error}</p>}
      {health?.store === "memory" && (
        <p className="rounded-md border border-watch/40 bg-watch/10 px-3 py-2 text-xs text-watch">{health.store_note}</p>
      )}

      <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-5">
        {stages.map((s, i) => (
          <li key={s.key} className="bg-panel px-3 py-2">
            <div className="num text-[10px] font-semibold tracking-widest text-accent">{i + 1} · {s.key}</div>
            <div className="truncate text-xs text-muted">{s.text}</div>
          </li>
        ))}
      </ol>

      {factory && (
        <Card title="Production cell dependency graph" stage="TRACE"
          action={<span className="text-[11px] text-muted">Select a station to trace its blast radius</span>}>
          <FactoryGraph factory={factory} live={live} selected={selected} trace={trace} onSelect={(id) => { setSelected(id); setRisk(null); }} />
          {trace && machine && (
            <div className="mt-3 grid grid-cols-2 gap-4 border-t border-line pt-3 md:grid-cols-5">
              <Stat label="If this station stops" value={`−${trace.line_loss_pct}%`} hint={`line output ${trace.line_rate_baseline} → ${trace.line_rate_if_down} parts/h`} />
              <Stat label="Stations affected" value={trace.affected.length} hint={trace.affected.map((a) => a.id).join(", ") || "none downstream"} />
              <Stat label="First station starves" value={trace.affected.find((a) => a.starves_after_min !== null)?.starves_after_min != null ? `${trace.affected.find((a) => a.starves_after_min !== null)!.starves_after_min} min` : "—"} hint="with buffers half full" />
              <Stat label="Reroute available" value={trace.reroute_to.length ? trace.reroute_to.join(", ") : "none"} hint={trace.is_on_bottleneck ? "this stage is the line bottleneck" : `bottleneck: ${trace.bottleneck_stage.join(" + ")}`} />
              <Stat label="Workers in radius" value={trace.workers_in_radius} hint="at this and downstream stations" />
            </div>
          )}
        </Card>
      )}

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
              {(risk?.machine_id === selected && sel.status !== "maintenance" ? risk.drivers : []).map((d) => {
                const width = Math.min(100, Math.abs(d.contribution) * 100);
                return (
                  <div key={d.feature} className="grid grid-cols-[150px_1fr_52px] items-center gap-2 text-xs">
                    <span title={`now ${d.value} ${d.unit}, healthy ${d.healthy_value} ${d.unit}`}>{d.label}</span>
                    <div className="h-1.5 rounded bg-line">
                      <div className="h-1.5 rounded" style={{ width: `${width}%`, background: d.contribution >= 0 ? "#ef5b5b" : "#3fb68b" }} />
                    </div>
                    <span className="num text-right">{d.contribution >= 0 ? "+" : "−"}{Math.abs(d.contribution * 100).toFixed(0)} pts</span>
                  </div>
                );
              })}
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
            <DecisionPanel rec={rec} onDecided={() => api.audit().then(setAudit).catch(() => undefined)} />
          ) : (
            <p className="py-6 text-center text-xs text-muted">
              Run the simulation to compare continuing, throttling, a controlled shutdown and deferring to the next break for {machine.name}.
            </p>
          )}
        </Card>
      )}

      <Card title="Decision audit log" stage="AUDIT">
        {audit.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted">No operator decisions recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr className="text-left text-muted">
                  {["Time", "Station", "Risk", "Recommended", "Decision", "Chosen", "Operator", "Note"].map((h) => (
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

      <footer className="pb-4 text-center text-[11px] text-muted">{health?.advisory}</footer>
    </div>
  );
}
