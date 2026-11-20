// Supervisor page: station overview, load-capacity check, custom what-if runs, shift log and decisions.
import { AlertTriangle, CheckCircle2, ClipboardList, Clock, Factory as FactoryIcon, FlaskConical, LayoutGrid, Weight, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api, LEVEL_COLOR, pct, type Factory, type LoadCheck, type Overview, type WhatIfResult } from "../api";
import { ScenarioTable } from "../components/DecisionPanel";
import { Badge, Button, Card, Gauge, Stat } from "../components/ui";

const VERDICT = {
  yes: { color: "#2E9B74", label: "Can take the load", short: "Full load OK", icon: CheckCircle2 },
  caution: { color: "#C4871B", label: "With caution", short: "With caution", icon: AlertTriangle },
  no: { color: "#D64545", label: "Should not take the load", short: "No full load", icon: XCircle },
} as const;
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—");
const th = "border-b border-line pb-2 pr-3 text-left font-medium text-muted";
const td = "border-b border-line/60 py-2 pr-3";
const input = "mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent";

export function SupervisorPage({ factory }: { factory: Factory }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  const [lcMachine, setLcMachine] = useState(factory.machines[0].id);
  const [load, setLoad] = useState(100);
  const [hours, setHours] = useState(8);
  const [lcAssume, setLcAssume] = useState(false);
  const [lcRisk, setLcRisk] = useState(30);
  const [check, setCheck] = useState<LoadCheck | null>(null);

  const [wiMachine, setWiMachine] = useState(factory.machines[0].id);
  const [wiAssume, setWiAssume] = useState(true);
  const [wiRisk, setWiRisk] = useState(60);
  const [workers, setWorkers] = useState(2);
  const [reroute, setReroute] = useState(true);
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = () => api.overview().then((o) => { if (!stop) { setOverview(o); setError(""); } }).catch((e) => { if (!stop) setError((e as Error).message); });
    load();
    const t = setInterval(load, 5000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); setError(""); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const runCheck = () => run(async () => setCheck(await api.loadCheck({
    machine_id: lcMachine, load_pct: load, hours, risk_override: lcAssume ? lcRisk / 100 : null })));
  const runWhatIf = () => run(async () => setResult(await api.whatIf({
    machine_id: wiMachine, risk: wiAssume ? wiRisk / 100 : null, workers_nearby: workers, reroute_available: reroute })));

  const stationSelect = (value: string, set: (v: string) => void) => (
    <select value={value} onChange={(e) => set(e.target.value)} className={input}>
      {factory.machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
    </select>
  );
  const V = check ? VERDICT[check.verdict] : null;

  return (
    <div className="space-y-4">
      {error && <p className="rounded-xl bg-high/10 px-4 py-2 text-xs text-high" role="alert">{error}</p>}

      <Card title="Stations" icon={<LayoutGrid size={16} />}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {overview?.stations.map((s) => {
            const maint = s.status === "maintenance";
            const level = maint ? "maintenance" : s.risk >= 0.6 ? "high" : s.risk >= 0.3 ? "watch" : "normal";
            const v = VERDICT[s.can_take_full_load];
            return (
              <div key={s.id} className="flex flex-col items-center gap-2 rounded-2xl bg-raised p-4 text-center">
                <Gauge value={maint ? 0 : s.risk} color={LEVEL_COLOR[level]} size={92} text={maint ? "—" : undefined} label="risk" />
                <div className="text-xs font-semibold">{s.name}</div>
                {maint ? <Badge color={LEVEL_COLOR.maintenance}>maintenance</Badge> : <Badge color={v.color}>{v.short}</Badge>}
                <div className="num text-[11px] text-muted" title="Highest load that keeps the chance of failure under 30% for a shift">
                  {maint ? "—" : `safe up to ${s.max_safe_load_pct ?? "<40"}%`}
                </div>
                {s.fault_component && <div className="flex items-center gap-1 text-[11px] text-high"><AlertTriangle size={12} />{s.fault_component}</div>}
              </div>
            );
          })}
        </div>
        {!overview && <p className="py-3 text-center text-xs text-muted">Loading…</p>}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Load check" icon={<Weight size={16} />}>
          <div className="grid grid-cols-2 gap-3 text-[11px] text-muted md:grid-cols-4">
            <label>Station{stationSelect(lcMachine, setLcMachine)}</label>
            <label>Load <span className="num font-semibold text-text">{load}%</span>
              <input type="range" min={40} max={130} step={5} value={load} onChange={(e) => setLoad(Number(e.target.value))} className="mt-2 w-full accent-[#A584AD]" />
            </label>
            <label>Hours
              <input type="number" min={0.5} max={24} step={0.5} value={hours} onChange={(e) => setHours(Number(e.target.value))} className={input} />
            </label>
            <label>Risk
              <select value={lcAssume ? "assume" : "live"} onChange={(e) => setLcAssume(e.target.value === "assume")} className={input}>
                <option value="live">Live</option>
                <option value="assume">Assumed</option>
              </select>
            </label>
          </div>
          {lcAssume && (
            <label className="mt-3 block text-[11px] text-muted">Assumed risk <span className="num font-semibold text-text">{lcRisk}%</span>
              <input type="range" min={0} max={95} step={1} value={lcRisk} onChange={(e) => setLcRisk(Number(e.target.value))} className="mt-2 w-full accent-[#A584AD]" />
            </label>
          )}
          <Button variant="primary" className="mt-3" disabled={busy} onClick={runCheck}><Weight size={14} />Check</Button>

          {check && V && (
            <div className="mt-4 flex flex-wrap items-center gap-5 rounded-2xl p-4" style={{ background: `${V.color}14` }}>
              <Gauge value={check.failure_probability} color={V.color} size={110} label="failure chance" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-base font-semibold" style={{ color: V.color }}><V.icon size={20} />{V.label}</div>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <Stat label="at normal load" value={pct(check.failure_probability_nominal)} />
                  <Stat label="highest safe load" value={check.max_safe_load_pct != null ? `${check.max_safe_load_pct}%` : "<40%"} />
                  <Stat label="line parts/h" value={check.line_rate} />
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-[11px] font-semibold text-muted">How it is worked out</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-muted">{check.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
                </details>
              </div>
            </div>
          )}
        </Card>

        <Card title="Shift log" icon={<Clock size={16} />}>
          <div className="max-h-[330px] overflow-auto">
            <table className="w-full text-xs">
              <thead><tr>{["User", "In", "Out", "Minutes"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {overview?.sessions.map((s) => (
                  <tr key={s.session_id}>
                    <td className={td}><span className="font-semibold">{s.username}</span> <span className="text-muted">· {s.role}</span></td>
                    <td className={`${td} num`}>{time(s.login_at)}</td>
                    <td className={`${td} num`}>{s.logout_at ? time(s.logout_at) : <Badge color="#2E9B74">signed in</Badge>}</td>
                    <td className={`${td} num`}>{s.duration_min ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title="What-if" icon={<FlaskConical size={16} />}>
        <div className="grid grid-cols-2 gap-3 text-[11px] text-muted md:grid-cols-5">
          <label>Station{stationSelect(wiMachine, setWiMachine)}</label>
          <label>Risk
            <select value={wiAssume ? "assume" : "live"} onChange={(e) => setWiAssume(e.target.value === "assume")} className={input}>
              <option value="assume">Assumed</option>
              <option value="live">Live</option>
            </select>
          </label>
          <label className={wiAssume ? "" : "opacity-40"}>Assumed risk <span className="num font-semibold text-text">{wiRisk}%</span>
            <input type="range" min={0} max={95} step={1} value={wiRisk} disabled={!wiAssume} onChange={(e) => setWiRisk(Number(e.target.value))} className="mt-2 w-full accent-[#A584AD]" />
          </label>
          <label>Workers nearby
            <input type="number" min={0} max={20} value={workers} onChange={(e) => setWorkers(Number(e.target.value))} className={input} />
          </label>
          <label className="flex items-end gap-2 pb-1.5 text-xs text-text">
            <input type="checkbox" checked={reroute} onChange={(e) => setReroute(e.target.checked)} className="accent-[#A584AD]" />
            Reroute possible
          </label>
        </div>
        <Button variant="primary" className="mt-3" disabled={busy} onClick={runWhatIf}><FlaskConical size={14} />{busy ? "Simulating…" : "Run"}</Button>
        {result ? (
          <div className="mt-4"><ScenarioTable scenarios={result.scenarios} recommended={result.recommended} /></div>
        ) : (
          <div className="mt-2 flex flex-col items-center gap-2 py-6 text-muted">
            <FactoryIcon size={28} />
            <p className="text-xs">Planning only. Nothing changes on the floor.</p>
          </div>
        )}
      </Card>

      <Card title="Recommendations" icon={<ClipboardList size={16} />}>
        <div className="max-h-[320px] overflow-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead><tr>{["Time", "Station", "Risk", "Option", "Decision", "By"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {overview?.recommendations.map((r) => (
                <tr key={r.id}>
                  <td className={`${td} num`}>{time(r.created_at)}</td>
                  <td className={td}>{r.machine_id}</td>
                  <td className={`${td} num`}>{pct(Number(r.risk_score))}</td>
                  <td className={`${td} num`}>{r.recommended_option}</td>
                  <td className={td}>{r.decision ? <Badge color={r.decision === "approved" ? "#2E9B74" : r.decision === "rejected" ? "#D64545" : "#C4871B"}>{r.decision}</Badge> : <span className="text-muted">waiting</span>}</td>
                  <td className={td}>{r.decided_by ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {overview && overview.recommendations.length === 0 && <p className="py-3 text-center text-xs text-muted">None yet</p>}
      </Card>
    </div>
  );
}
