"use client";

import type { InvoiceStatus } from "@/lib/api";

const STATUS: Record<InvoiceStatus, { label: string; cls: string }> = {
  paid: { label: "Paid", cls: "bg-emerald-100 text-emerald-800 ring-emerald-200" },
  pending_approval: { label: "Needs approval", cls: "bg-amber-100 text-amber-800 ring-amber-200" },
  approved: { label: "Approved", cls: "bg-sky-100 text-sky-800 ring-sky-200" },
  submitted: { label: "Recorded", cls: "bg-slate-100 text-slate-700 ring-slate-200" },
  rejected: { label: "Rejected", cls: "bg-rose-100 text-rose-800 ring-rose-200" },
  blocked: { label: "Blocked", cls: "bg-rose-100 text-rose-800 ring-rose-200" },
  error: { label: "Error", cls: "bg-rose-100 text-rose-800 ring-rose-200" },
};

export function StatusPill({ status }: { status: InvoiceStatus }) {
  const s = STATUS[status] ?? STATUS.error;
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}>{s.label}</span>;
}

export function TxLink({ hash, explorer, label }: { hash?: string; explorer: string; label: string }) {
  if (!hash) return null;
  return (
    <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-teal-700 underline-offset-2 hover:underline">
      {label} ↗
    </a>
  );
}

export function AddrLink({ address, explorer, children }: { address?: string | null; explorer: string; children?: React.ReactNode }) {
  if (!address) return <span className="text-slate-400">—</span>;
  return (
    <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-teal-700 underline-offset-2 hover:underline">
      {children ?? `${address.slice(0, 6)}…${address.slice(-4)}`}
    </a>
  );
}

export function Card({ title, children, right }: { title?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      {(title || right) && (
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-xl tabular-nums text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function Button({ children, onClick, disabled, variant = "primary", busy }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: "primary" | "ghost" | "danger"; busy?: boolean }) {
  const base = "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
  const v =
    variant === "primary"
      ? "bg-teal-700 text-white hover:bg-teal-800"
      : variant === "danger"
        ? "bg-rose-600 text-white hover:bg-rose-700"
        : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
  return (
    <button className={`${base} ${v}`} onClick={onClick} disabled={disabled || busy}>
      {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />}
      {children}
    </button>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">{children}</div>;
}
