// Supervisor page: station overview, load-capacity check, custom what-if runs, shift log and decisions.
import { useEffect, useState } from "react";
import { api, LEVEL_COLOR, pct, type Factory, type LiveMachine, type LoadCheck, type Overview, type WhatIfResult } from "../api";
import { ScenarioTable } from "../components/DecisionPanel";
import { Badge, Button, Card, Stat } from "../components/ui";

const VERDICT = {
  yes: { color: "#3fb68b", label: "Can take the load" },
  caution: { color: "#e2a93b", label: "With caution" },
  no: { color: "#ef5b5b", label: "Should not take the load" },
} as const;
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
const th = "border-b border-line pb-2 pr-3 text-left font-medium text-muted";
const td = "border-b border-line/60 py-2 pr-3";
const input = "mt-1 w-full rounded-md border border-line bg-ink px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent";

export function SupervisorPage({ factory, live }: { factory: Factory; live: Record<string, LiveMachine> }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  // load check
  const [lcMachine, setLcMachine] = useState(factory.machines[0].id);
  const [load, setLoad] = useState(100);
  const [hours, setHours] = useState(8);
  const [lcAssume, setLcAssume] = useState(false);
  const [lcRisk, setLcRisk] = useState(30);
  const [check, setCheck] = useState<LoadCheck | null>(null);

  // what-if
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

  return (
    <div className="space-y-4">
      {error && <p className="rounded-md border border-high/40 bg-high/10 px-3 py-2 text-xs text-high" role="alert">{error}</p>}

      <Card title="Stations at a glance" stage="OVERVIEW">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-xs">
            <thead>
              <tr>{["Station", "Status", "Failure risk (8 h)", "Fault location", "Full load for a shift?", "Highest safe load", "Hours since maintenance"].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {overview?.stations.map((s) => {
                const level = live[s.id]?.level ?? "normal";
                return (
                  <tr key={s.id}>
                    <td className={`${td} font-semibold`}>{s.name}</td>
                    <td className={td}>{s.status}{s.stale ? " · telemetry missing" : ""}</td>
                    <td className={`${td} num`} style={{ color: LEVEL_COLOR[level] }}>{s.status === "maintenance" ? "—" : pct(s.risk)}</td>
                    <td className={td}>{s.fault_component ?? "none found"}</td>
                    <td className={td}>{s.status === "maintenance" ? "—" : <Badge color={VERDICT[s.can_take_full_load].color}>{VERDICT[s.can_take_full_load].label}</Badge>}</td>
                    <td className={`${td} num`}>{s.status === "maintenance" ? "—" : s.max_safe_load_pct != null ? `${s.max_safe_load_pct}%` : "below 40%"}</td>
                    <td className={`${td} num`}>{s.hours_since_maintenance ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!overview && <p className="py-3 text-center text-xs text-muted">Loading…</p>}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Can this station take the load?" stage="LOAD CHECK">
          <div className="grid grid-cols-2 gap-3 text-[11px] text-muted md:grid-cols-4">
            <label>Station{stationSelect(lcMachine, setLcMachine)}</label>
            <label>Load: <span className="num text-text">{load}%</span> of nominal
              <input type="range" min={40} max={130} step={5} value={load} onChange={(e) => setLoad(Number(e.target.value))} className="mt-2 w-full accent-[#4cc2d6]" />
            </label>
            <label>For how long (hours)
              <input type="number" min={0.5} max={24} step={0.5} value={hours} onChange={(e) => setHours(Number(e.target.value))} className={input} />
            </label>
            <label>Failure risk to use
              <select value={lcAssume ? "assume" : "live"} onChange={(e) => setLcAssume(e.target.value === "assume")} className={input}>
                <option value="live">Live score</option>
                <option value="assume">Assume a value</option>
              </select>
            </label>
          </div>
          {lcAssume && (
            <label className="mt-3 block text-[11px] text-muted">Assumed 8-hour failure risk: <span className="num text-text">{lcRisk}%</span>
              <input type="range" min={0} max={95} step={1} value={lcRisk} onChange={(e) => setLcRisk(Number(e.target.value))} className="mt-2 w-full accent-[#4cc2d6]" />
            </label>
          )}
          <Button variant="primary" className="mt-3" disabled={busy} onClick={runCheck}>Check load</Button>

          {check && (
            <div className="mt-4 rounded-lg border p-4" style={{ borderColor: `${VERDICT[check.verdict].color}88`, background: `${VERDICT[check.verdict].color}10` }}>
              <div className="text-base font-semibold" style={{ color: VERDICT[check.verdict].color }}>{VERDICT[check.verdict].label}</div>
              <p className="mt-0.5 text-xs">{check.verdict_text}</p>
              <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
                <Stat label="Chance of failure" value={pct(check.failure_probability)} hint={`at ${check.load_pct}% for ${check.hours} h`} />
                <Stat label="At nominal load" value={pct(check.failure_probability_nominal)} hint={`risk used: ${pct(check.risk_score)} (${check.risk_source})`} />
                <Stat label="Highest safe load" value={check.max_safe_load_pct != null ? `${check.max_safe_load_pct}%` : "below 40%"} hint="keeps failure chance under 30%" />
                <Stat label="Line output" value={`${check.line_rate} /h`} hint={`nominal ${check.line_rate_nominal} parts/h`} />
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-muted">How this is worked out</summary>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-muted">{check.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
              </details>
            </div>
          )}
        </Card>

        <Card title="Shift log" stage="SIGN-IN · SIGN-OUT">
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full text-xs">
              <thead><tr>{["User", "Role", "Signed in", "Signed out", "Duration"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {overview?.sessions.map((s) => (
                  <tr key={s.session_id}>
                    <td className={`${td} font-semibold`}>{s.username}</td>
                    <td className={td}>{s.role}</td>
                    <td className={`${td} num`}>{time(s.login_at)}</td>
                    <td className={`${td} num`}>{s.logout_at ? time(s.logout_at) : <Badge color="#3fb68b">signed in</Badge>}</td>
                    <td className={`${td} num`}>{s.duration_min != null ? `${s.duration_min} min` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-muted">A session with no sign-out is either still open or the browser was closed without signing out.</p>
        </Card>
      </div>

      <Card title="Try different circumstances" stage="WHAT-IF">
        <div className="grid grid-cols-2 gap-3 text-[11px] text-muted md:grid-cols-5">
          <label>Station{stationSelect(wiMachine, setWiMachine)}</label>
          <label>Failure risk
            <select value={wiAssume ? "assume" : "live"} onChange={(e) => setWiAssume(e.target.value === "assume")} className={input}>
              <option value="assume">Assume a value</option>
              <option value="live">Live score</option>
            </select>
          </label>
          <label className={wiAssume ? "" : "opacity-40"}>Assumed risk: <span className="num text-text">{wiRisk}%</span>
            <input type="range" min={0} max={95} step={1} value={wiRisk} disabled={!wiAssume} onChange={(e) => setWiRisk(Number(e.target.value))} className="mt-2 w-full accent-[#4cc2d6]" />
          </label>
          <label>Workers near the station
            <input type="number" min={0} max={20} value={workers} onChange={(e) => setWorkers(Number(e.target.value))} className={input} />
          </label>
          <label className="flex items-end gap-2 pb-1.5 text-xs text-text">
            <input type="checkbox" checked={reroute} onChange={(e) => setReroute(e.target.checked)} className="accent-[#4cc2d6]" />
            Parallel station can take rerouted work
          </label>
        </div>
        <Button variant="primary" className="mt-3" disabled={busy} onClick={runWhatIf}>{busy ? "Simulating…" : "Run what-if"}</Button>
        {result ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs">
              With a failure risk of <span className="num">{pct(result.circumstances.risk)}</span> ({result.circumstances.risk_source}),{" "}
              {result.circumstances.workers_nearby} worker(s) nearby and rerouting {result.circumstances.reroute_available ? "available" : "not available"},
              the best option is <span className="num font-semibold text-accent">{result.recommended}</span>.
            </p>
            <ScenarioTable scenarios={result.scenarios} recommended={result.recommended} />
            <p className="text-[11px] text-muted">This run is for planning only. Nothing is stored and nothing changes on the floor.</p>
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-muted">Choose a station and the circumstances to compare the four options. Nothing is stored and nothing changes on the floor.</p>
        )}
      </Card>

      <Card title="Recommendations and decisions" stage="AUDIT">
        <div className="max-h-[320px] overflow-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead><tr>{["Time", "Station", "Risk", "Recommended", "Decision", "Decided by"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {overview?.recommendations.map((r) => (
                <tr key={r.id}>
                  <td className={`${td} num`}>{time(r.created_at)}</td>
                  <td className={td}>{r.machine_id}</td>
                  <td className={`${td} num`}>{pct(Number(r.risk_score))}</td>
                  <td className={`${td} num`}>{r.recommended_option}</td>
                  <td className={td}>{r.decision ? <Badge color={r.decision === "approved" ? "#3fb68b" : r.decision === "rejected" ? "#ef5b5b" : "#e2a93b"}>{r.decision}</Badge> : <span className="text-muted">awaiting decision</span>}</td>
                  <td className={td}>{r.decided_by ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {overview && overview.recommendations.length === 0 && <p className="py-3 text-center text-xs text-muted">No recommendations yet.</p>}
      </Card>
    </div>
  );
}
