// SIMULATE + DECIDE: option comparison, explained recommendation and the operator's decision.
import { Check, Gauge as GaugeIcon, Pause, Play, ShieldAlert, Timer, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, inr, pct, type OptionKey, type Recommendation, type Scenario, type User } from "../api";
import { Badge, Button, Gauge } from "./ui";

const CONF_COLOR = { low: "#D64545", medium: "#C4871B", high: "#2E9B74" } as const;
const OPTION_ICON = { A: Play, B: GaugeIcon, C: Pause, D: Timer } as const;

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="mt-1 h-1.5 w-full rounded-full bg-raised">
      <div className="h-1.5 rounded-full" style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`, background: color }} />
    </div>
  );
}

/** One card per option, so the four responses can be compared at a glance. */
export function ScenarioTable({ scenarios, recommended }: { scenarios: Scenario[]; recommended: OptionKey }) {
  const max = (f: (s: Scenario) => number) => Math.max(...scenarios.map(f));
  const rows: { label: string; cell: (s: Scenario) => string; bar: (s: Scenario) => number; color: string }[] = [
    { label: "Failure chance", cell: (s) => pct(s.unplanned_failure_probability), bar: (s) => s.unplanned_failure_probability, color: "#D64545" },
    { label: "Output (parts)", cell: (s) => s.throughput_units.toFixed(0), bar: (s) => s.throughput_units, color: "#2E9B74" },
    { label: "Downtime (min)", cell: (s) => s.downtime_min.toFixed(0), bar: (s) => s.downtime_min, color: "#C4871B" },
    { label: "Worker exposure", cell: (s) => s.worker_exposure_index.toFixed(0), bar: (s) => s.worker_exposure_index, color: "#D64545" },
    { label: "Cost", cell: (s) => inr(s.estimated_cost), bar: (s) => s.estimated_cost, color: "#A584AD" },
    { label: "Orders at risk", cell: (s) => String(s.orders_at_risk), bar: (s) => s.orders_at_risk, color: "#C4871B" },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {scenarios.map((s) => {
        const best = s.key === recommended;
        const Icon = OPTION_ICON[s.key];
        return (
          <div key={s.key} title={s.description}
            className={`rounded-2xl border p-4 ${best ? "border-brand bg-raised shadow-[0_4px_14px_rgba(107,69,71,0.15)]" : "border-line"}`}>
            <div className="flex items-center gap-2.5">
              <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-white ${best ? "bg-brand" : "bg-accent"}`}><Icon size={18} /></span>
              <div className="min-w-0">
                <div className="num text-[11px] text-muted">Option {s.key}</div>
                <div className="truncate text-sm font-semibold">{s.name}</div>
              </div>
            </div>
            <div className="mt-2 flex h-5 gap-1.5">
              {best && <Badge color="#6B4547">recommended</Badge>}
              {s.blocked_by_safety_gate && <Badge color="#D64545">too risky</Badge>}
            </div>
            <div className="mt-2 space-y-2.5">
              {rows.map((r) => (
                <div key={r.label}>
                  <div className="flex justify-between text-[11px]"><span className="text-muted">{r.label}</span><span className="num font-semibold">{r.cell(s)}</span></div>
                  <Bar value={r.bar(s)} max={max(r.bar)} color={r.color} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DecisionPanel({ rec, user, onDecided }: { rec: Recommendation; user: User; onDecided: () => void }) {
  const p = rec.payload;
  const [note, setNote] = useState("");
  const [override, setOverride] = useState<OptionKey | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState("");

  useEffect(() => { setOutcome(""); setError(""); setNote(""); setOverride(""); }, [rec.id]);

  const submit = async (action: "approved" | "rejected" | "overridden") => {
    setBusy(true);
    setError("");
    try {
      const res = await api.decide(rec.id, { action, chosen_option: action === "overridden" && override ? override : undefined, note });
      setOutcome(`${action === "approved" ? "Approved" : action === "rejected" ? "Rejected" : `Overridden with option ${res.chosen_option}`}. ${res.effect}`);
      onDecided();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const conf = p.confidence;
  const BestIcon = OPTION_ICON[rec.recommended_option];

  return (
    <div className="space-y-4">
      <ScenarioTable scenarios={p.simulation.scenarios} recommended={rec.recommended_option} />

      <div className="flex flex-wrap items-center gap-5 rounded-2xl bg-gradient-to-r from-brand to-accent p-5 text-white">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20"><BestIcon size={28} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-xs opacity-80">Recommended for {p.machine.name}</div>
          <div className="text-lg font-semibold">Option {rec.recommended_option} · {p.recommended_name}</div>
          <div className="mt-1 text-xs opacity-90">{p.reasons[2] ?? p.reasons[1]}</div>
        </div>
        <div className="rounded-2xl bg-white p-2"><Gauge value={conf.value} color={CONF_COLOR[conf.label]} size={84} label="confidence" /></div>
      </div>

      <details className="rounded-2xl border border-line px-4 py-3">
        <summary className="cursor-pointer text-xs font-semibold text-muted">Reasons, trade-offs and assumptions</summary>
        <div className="mt-3 grid gap-4 text-xs leading-relaxed md:grid-cols-3">
          {([["Why", p.reasons], ["Trade-offs", p.trade_offs], ["Assumptions", p.assumptions]] as const).map(([head, items]) => (
            <div key={head}>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent-strong">{head}</h3>
              <ul className="list-disc space-y-1.5 pl-4 text-muted">{items.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          ))}
        </div>
      </details>

      <div className="rounded-2xl bg-raised p-4">
        {outcome ? (
          <p className="flex items-center gap-2 text-xs text-ok" role="status"><Check size={16} />{outcome}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs text-muted"><ShieldAlert size={14} />{user.username} decides</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (needed to override)"
                className="min-w-[180px] flex-1 rounded-lg border border-line bg-white px-3 py-1.5 text-xs outline-none focus:border-accent" />
              <Button variant="primary" disabled={busy} onClick={() => submit("approved")}><Check size={14} />Approve {rec.recommended_option}</Button>
              <Button variant="danger" disabled={busy} onClick={() => submit("rejected")}><X size={14} />Reject</Button>
              <select value={override} onChange={(e) => setOverride(e.target.value as OptionKey | "")} aria-label="Override with another option"
                className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs outline-none focus:border-accent">
                <option value="">Override with…</option>
                {p.simulation.scenarios.filter((s) => s.key !== rec.recommended_option).map((s) => (
                  <option key={s.key} value={s.key}>Option {s.key} · {s.name}</option>
                ))}
              </select>
              <Button disabled={!override || !note.trim() || busy} onClick={() => submit("overridden")}>Override</Button>
            </div>
            {error && <p className="mt-2 text-xs text-high" role="alert">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
