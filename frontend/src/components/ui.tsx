// Small shadcn/ui-style primitives (Card, Button, Badge) built on Tailwind.
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Card({ title, stage, action, children, className = "" }: {
  title: string; stage?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-lg border border-line bg-panel ${className}`}>
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          {stage && <span className="num text-[10px] font-semibold tracking-widest text-accent">{stage}</span>}
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

type Variant = "primary" | "outline" | "danger" | "ghost";
const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-ink hover:brightness-110",
  outline: "border border-line bg-raised text-text hover:border-muted",
  danger: "border border-high/60 text-high hover:bg-high/10",
  ghost: "text-muted hover:text-text",
};

export function Button({ variant = "outline", className = "", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-semibold transition
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
        disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT[variant]} ${className}`}
    />
  );
}

export function Badge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
      style={{ color, borderColor: `${color}66`, background: `${color}14` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="num text-lg font-semibold leading-tight">{value}</div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}
