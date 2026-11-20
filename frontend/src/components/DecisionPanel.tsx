// SIMULATE + DECIDE: option comparison, explained recommendation and the operator's decision.
import { useEffect, useState } from "react";
import { api, inr, pct, type OptionKey, type Recommendation, type Scenario, type User } from "../api";
import { Badge, Button } from "./ui";

const CONF_COLOR = { low: "#ef5b5b", medium: "#e2a93b", high: "#3fb68b" } as const;

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="mt-1 h-1 w-full rounded bg-line">
      <div className="h-1 rounded" style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`, background: color }} />
    </div>
  );
}

export function ScenarioTable({ scenarios, recommended }: { scenarios: Scenario[]; recommended: OptionKey }) {
  const max = (f: (s: Scenario) => number) => Math.max(...scenarios.map(f));
  const cols: { head: string; hint: string; cell: (s: Scenario) => string; bar: (s: Scenario) => number; color: string }[] = [
    { head: "Unplanned failure", hint: "chance within the shift", cell: (s) => pct(s.unplanned_failure_probability), bar: (s) => s.unplanned_failure_probability, color: "#ef5b5b" },
    { head: "Output", hint: "parts (5th–95th pct.)", cell: (s) => `${s.throughput_units.toFixed(0)} (${s.throughput_p05}–${s.throughput_p95})`, bar: (s) => s.throughput_units, color: "#3fb68b" },
    { head: "Downtime", hint: "station minutes", cell: (s) => s.downtime_min.toFixed(0), bar: (s) => s.downtime_min, color: "#e2a93b" },
    { head: "Downstream starved", hint: "extra min per station", cell: (s) => s.downstream_starved_min.toFixed(0), bar: (s) => s.downstream_starved_min, color: "#e2a93b" },
    { head: "Worker exposure", hint: "index 0–100", cell: (s) => s.worker_exposure_index.toFixed(0), bar: (s) => s.worker_exposure_index, color: "#ef5b5b" },
    { head: "Est. cost", hint: "illustrative", cell: (s) => inr(s.estimated_cost), bar: (s) => s.estimated_cost, color: "#c58af9" },
    { head: "Orders at risk", hint: "of work orders due", cell: (s) => String(s.orders_at_risk), bar: (s) => s.orders_at_risk, color: "#e2a93b" },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-separate border-spacing-0 text-xs">
        <thead>
          <tr className="text-left text-muted">
            <th className="border-b border-line pb-2 pr-3 font-medium">Option</th>
            {cols.map((c) => (
              <th key={c.head} className="border-b border-line px-2 pb-2 font-medium">
                {c.head}<div className="text-[10px] font-normal">{c.hint}</div>
              </th>
            ))}
            <th className="border-b border-line pb-2 pl-2 font-medium">Score<div className="text-[10px] font-normal">lower is better</div></th>
          </tr>
        </thead>
        <tbody>
          {scenarios.map((s) => {
            const best = s.key === recommended;
            return (
              <tr key={s.key} className={best ? "bg-accent/8" : ""}>
                <td className={`border-b border-line py-2.5 pr-3 align-top ${best ? "border-l-2 border-l-accent pl-2" : "pl-2"}`}>
                  <div className="flex items-center gap-2 font-semibold">
                    <span className="num text-accent">{s.key}</span>{s.name}
                  </div>
                  <div className="mt-0.5 max-w-[230px] text-[11px] text-muted">{s.description}</div>
                  <div className="mt-1 flex gap-1.5">
                    {best && <Badge color="#4cc2d6">recommended</Badge>}
                    {s.blocked_by_safety_gate && <Badge color="#ef5b5b">safety gate</Badge>}
                  </div>
                </td>
                {cols.map((c) => (
                  <td key={c.head} className="border-b border-line px-2 py-2.5 align-top">
                    <span className="num">{c.cell(s)}</span>
                    <Bar value={c.bar(s)} max={max(c.bar)} color={c.color} />
                  </td>
                ))}
                <td className="num border-b border-line py-2.5 pl-2 align-top font-semibold">{s.score.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <ul className="space-y-1.5 text-xs leading-relaxed">
        {items.map((t) => <li key={t} className="border-l border-line pl-2.5">{t}</li>)}
      </ul>
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
      setOutcome(`${action === "approved" ? "Approved" : action === "rejected" ? "Rejected" : `Overridden with option ${res.chosen_option}`} by ${res.operator}. ${res.effect}`);
      onDecided();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const conf = p.confidence;

  return (
    <div className="space-y-5">
      <ScenarioTable scenarios={p.simulation.scenarios} recommended={rec.recommended_option} />
      <p className="text-[11px] text-muted">
        Each option replayed {p.simulation.replications}× over a {p.simulation.horizon_min / 60}-hour shift (seed {p.simulation.seed}).
        Healthy baseline: {p.simulation.baseline_throughput_units.toFixed(0)} parts. Score weights:{" "}
        {Object.entries(p.simulation.weights).map(([k, v]) => `${k.replace("_", " ")} ${v}`).join(", ")}.
      </p>

      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-4 rounded-lg border border-accent/40 bg-accent/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted">Recommended for {p.machine.name}</div>
              <div className="text-base font-semibold">
                <span className="num text-accent">Option {rec.recommended_option}</span> · {p.recommended_name}
              </div>
            </div>
            <div className="text-right">
              <Badge color={CONF_COLOR[conf.label]}>{conf.label} confidence · {pct(conf.value)}</Badge>
              <div className="num mt-1 text-[10px] text-muted">
                model {conf.parts.model_skill} · data {conf.parts.telemetry_completeness} · margin {conf.parts.decision_margin}
              </div>
            </div>
          </div>
          <List title="Why" items={p.reasons} />
          <List title="What the other options trade off" items={p.trade_offs} />
          {p.risk.drivers.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Telemetry inputs behind the risk score</h3>
              <div className="num grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3">
                {p.risk.drivers.map((d) => (
                  <div key={d.feature} className="flex justify-between gap-2 border-b border-line/60 py-0.5">
                    <span className="font-sans text-muted">{d.label}</span>
                    <span>{d.value.toFixed(d.feature === "vib_slope" ? 3 : 1)} {d.unit.split(" ")[0]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <details className="rounded-lg border border-line p-4" open>
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-muted">Assumptions and limits</summary>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted">
            {p.assumptions.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </details>
      </div>

      <div className="rounded-lg border border-line bg-raised p-4">
        <h3 className="text-sm font-semibold">Operator decision</h3>
        <p className="mt-0.5 text-[11px] text-muted">{p.advisory}</p>
        {outcome ? (
          <p className="mt-3 rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-xs" role="status">{outcome} The decision is in the audit log.</p>
        ) : (
          <>
            <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr]">
              <div className="text-[11px] text-muted">
                Deciding as
                <div className="mt-1 rounded-md border border-line bg-ink px-2.5 py-1.5 text-xs text-text">{user.username} · {user.role}</div>
              </div>
              <label className="text-[11px] text-muted">
                Note (required for an override)
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason, shift context, work-order constraints…"
                  className="mt-1 w-full rounded-md border border-line bg-ink px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent" />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={busy} onClick={() => submit("approved")}>
                Approve option {rec.recommended_option}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => submit("rejected")}>Reject</Button>
              <span className="mx-1 h-5 w-px bg-line" />
              <select value={override} onChange={(e) => setOverride(e.target.value as OptionKey | "")} aria-label="Override with another option"
                className="rounded-md border border-line bg-ink px-2 py-1.5 text-xs text-text outline-none focus:border-accent">
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
