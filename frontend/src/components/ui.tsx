// Small shadcn/ui-style primitives built on Tailwind: Card, Button, Badge, Stat, Gauge.
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Card({ title, icon, action, children, className = "" }: {
  title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-line bg-panel shadow-[0_1px_3px_rgba(107,69,71,0.08)] ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <div className="flex items-center gap-2.5">
          {icon && <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-raised text-brand">{icon}</span>}
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        {action}
      </header>
      <div className="p-5 pt-4">{children}</div>
    </section>
  );
}

type Variant = "primary" | "outline" | "danger" | "ghost";
const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-[#553638]",
  outline: "border border-line bg-panel text-text hover:border-accent",
  danger: "border border-high/50 text-high hover:bg-high/10",
  ghost: "text-muted hover:text-text",
};

export function Button({ variant = "outline", className = "", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
        disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT[variant]} ${className}`}
    />
  );
}

export function Badge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ color, background: `${color}1c` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

export function Stat({ label, value, icon }: { label: string; value: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      {icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-raised text-brand">{icon}</span>}
      <div>
        <div className="num text-lg font-semibold leading-tight">{value}</div>
        <div className="text-[11px] text-muted">{label}</div>
      </div>
    </div>
  );
}

/** Ring gauge for a 0..1 value, with the reading in the middle. */
export function Gauge({ value, color, size = 120, label, text }: {
  value: number; color: string; size?: number; label?: string; text?: string;
}) {
  const stroke = size * 0.1;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label ?? "value"} ${text ?? `${Math.round(v * 100)}%`}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EFE3F3" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v)} style={{ transition: "stroke-dashoffset 0.6s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num font-semibold leading-none" style={{ color, fontSize: size * 0.24 }}>{text ?? `${Math.round(v * 100)}%`}</span>
        {label && <span className="mt-1 text-muted" style={{ fontSize: Math.max(9, size * 0.09) }}>{label}</span>}
      </div>
    </div>
  );
}
