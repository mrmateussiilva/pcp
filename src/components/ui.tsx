import React from "react";
import { Terminal } from "lucide-react";

export function PageHeader({
  icon,
  title,
  subtitle,
  right,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 pb-1">
      <div className="flex items-center gap-3.5">
        <div className="w-10 h-10 rounded-xl bg-white dark:bg-white/[0.06] border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-700 dark:text-zinc-100 shadow-sm">
          {icon}
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            {title}
          </h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">{subtitle}</p>
        </div>
      </div>
      {right && <div className="flex items-center gap-2.5">{right}</div>}
    </div>
  );
}

export function SurfaceCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl bg-white dark:bg-[#151521]/90 border border-slate-200/90 dark:border-white/[0.07] shadow-sm dark:shadow-lg dark:shadow-black/20 ${className}`}
    >
      {children}
    </div>
  );
}

export function StatusBadge({
  active,
  activeText,
  idleText = "Parado",
  tone = "emerald",
}: {
  active: boolean;
  activeText: string;
  idleText?: string;
  tone?: "emerald" | "amber";
}) {
  if (!active) {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-zinc-800/80 text-slate-500 dark:text-zinc-400 border border-slate-200 dark:border-white/5">
        <span className="w-2 h-2 rounded-full bg-slate-400 dark:bg-zinc-500" />
        {idleText}
      </span>
    );
  }
  const color =
    tone === "amber"
      ? "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30"
      : "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30";
  const dot = tone === "amber" ? "bg-amber-500 dark:bg-amber-400" : "bg-emerald-500 dark:bg-emerald-400";
  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border ${color}`}
    >
      <span className={`w-2 h-2 rounded-full ${dot} animate-pulse`} />
      {activeText}
    </span>
  );
}

export function StatCard({
  label,
  value,
  tone = "emerald",
}: {
  label: string;
  value: number | string;
  tone?: "emerald" | "amber" | "red" | "sky" | "zinc" | "rose";
}) {
  const styles = {
    emerald:
      "text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/70 dark:bg-emerald-500/[0.04]",
    amber:
      "text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/20 bg-amber-50/70 dark:bg-amber-500/[0.04]",
    red: "text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/20 bg-red-50/70 dark:bg-red-500/[0.04]",
    sky: "text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-500/20 bg-sky-50/70 dark:bg-sky-500/[0.04]",
    rose: "text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-500/20 bg-rose-50/70 dark:bg-rose-500/[0.04]",
    zinc: "text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02]",
  }[tone];

  return (
    <div className={`rounded-xl border p-3.5 ${styles}`}>
      <div className="text-[11px] font-medium text-slate-500 dark:text-zinc-400">{label}</div>
      <div className={`text-2xl font-bold tabular-nums mt-1 ${styles.split(" ").slice(0, 2).join(" ")}`}>
        {value}
      </div>
    </div>
  );
}

export function TerminalLog({
  lines,
  emptyText = "Aguardando eventos...",
  logRef,
}: {
  lines: string[];
  emptyText?: string;
  logRef?: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-2xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/[0.07] overflow-hidden shadow-inner">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-100/80 dark:bg-white/[0.03] border-b border-slate-200 dark:border-white/[0.06] text-[11px] text-slate-500 dark:text-zinc-400">
        <span className="flex items-center gap-1.5 font-medium">
          <Terminal className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500" />
          Console de Saída
        </span>
        <span className="tabular-nums text-slate-400 dark:text-zinc-500">
          {lines.length} linha(s)
        </span>
      </div>
      <div
        ref={logRef}
        className="flex-1 overflow-y-auto p-3.5 font-mono text-xs text-slate-800 dark:text-zinc-200 space-y-1 select-text leading-relaxed"
      >
        {lines.length === 0 ? (
          <div className="text-slate-400 dark:text-zinc-600 text-center py-10">{emptyText}</div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className="break-words">
              {l}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
