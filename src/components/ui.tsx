import React from "react";
import { Terminal } from "lucide-react";

export function PageHeader({
  icon,
  title,
  subtitle,
  right,
  badge,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle: string;
  right?: React.ReactNode;
  badge?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-zinc-800">
      <div className="flex items-center gap-3">
        {icon && (
          <div className="w-8 h-8 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex items-center justify-center text-slate-700 dark:text-zinc-300 shadow-2xs">
            {icon}
          </div>
        )}
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight text-slate-900 dark:text-zinc-100 uppercase">
              {title}
            </h1>
            {badge && (
              <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800/60 text-slate-600 dark:text-zinc-400 font-medium">
                {badge}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">{subtitle}</p>
        </div>
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

export function SurfaceCard({
  children,
  className = "",
  header,
}: {
  children: React.ReactNode;
  className?: string;
  header?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-md bg-white dark:bg-[#111115] border border-slate-200 dark:border-zinc-800/90 shadow-2xs ${className}`}
    >
      {header && (
        <div className="px-3.5 py-2 border-b border-slate-200 dark:border-zinc-800/90 bg-slate-50/70 dark:bg-zinc-900/40 text-xs font-semibold text-slate-700 dark:text-zinc-300 flex items-center justify-between">
          {header}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatusBadge({
  active,
  activeText,
  idleText = "STANDBY",
  tone = "emerald",
}: {
  active: boolean;
  activeText: string;
  idleText?: string;
  tone?: "emerald" | "amber" | "blue";
}) {
  if (!active) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900 text-[11px] font-mono text-slate-500 dark:text-zinc-500">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-zinc-600" />
        <span className="uppercase">{idleText}</span>
      </span>
    );
  }

  const colorStyles = {
    emerald: "border-emerald-300 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400",
    amber: "border-amber-300 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
    blue: "border-blue-300 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400",
  }[tone];

  const dotStyles = {
    emerald: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]",
    amber: "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]",
    blue: "bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.5)]",
  }[tone];

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-mono font-medium ${colorStyles}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotStyles} animate-pulse`} />
      <span className="uppercase">{activeText}</span>
    </span>
  );
}

export function StatCard({
  label,
  value,
  tone = "zinc",
  unit,
}: {
  label: string;
  value: number | string;
  tone?: "emerald" | "amber" | "red" | "sky" | "zinc" | "rose" | "blue";
  unit?: string;
}) {
  const borderLeft = {
    emerald: "border-l-emerald-600 dark:border-l-emerald-500",
    amber: "border-l-amber-600 dark:border-l-amber-500",
    red: "border-l-red-600 dark:border-l-red-500",
    sky: "border-l-sky-600 dark:border-l-sky-500",
    blue: "border-l-blue-600 dark:border-l-blue-500",
    rose: "border-l-rose-600 dark:border-l-rose-500",
    zinc: "border-l-slate-400 dark:border-l-zinc-600",
  }[tone];

  return (
    <div className={`rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111115] p-3 border-l-3 ${borderLeft}`}>
      <div className="text-[10px] font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">
        {label}
      </div>
      <div className="text-xl font-bold font-mono text-slate-900 dark:text-zinc-100 tabular-nums mt-1 flex items-baseline gap-1">
        <span>{value}</span>
        {unit && <span className="text-xs font-sans font-normal text-slate-500 dark:text-zinc-400">{unit}</span>}
      </div>
    </div>
  );
}

export function TerminalLog({
  lines,
  emptyText = "Aguardando eventos...",
  logRef,
  onClear,
}: {
  lines: string[];
  emptyText?: string;
  logRef?: React.RefObject<HTMLDivElement | null>;
  onClear?: () => void;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-md bg-slate-900 dark:bg-[#09090b] border border-slate-700/60 dark:border-zinc-800 overflow-hidden shadow-2xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/80 dark:bg-zinc-900/90 border-b border-slate-700/60 dark:border-zinc-800 text-[11px] font-mono text-slate-300 dark:text-zinc-400">
        <span className="flex items-center gap-1.5 font-semibold">
          <Terminal className="w-3.5 h-3.5 text-slate-400" />
          <span>CONSOLE // STDOUT</span>
        </span>
        <div className="flex items-center gap-3">
          <span className="tabular-nums text-[10px] text-slate-400">
            {lines.length} EVT
          </span>
          {onClear && (
            <button
              onClick={onClear}
              className="text-[10px] text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              LIMPAR
            </button>
          )}
        </div>
      </div>
      <div
        ref={logRef}
        className="flex-1 overflow-y-auto p-3 font-mono text-[11px] text-slate-200 space-y-1 select-text leading-relaxed bg-[#0a0f1d] dark:bg-[#070709]"
      >
        {lines.length === 0 ? (
          <div className="text-slate-500 dark:text-zinc-600 text-center py-8">{emptyText}</div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className="break-all font-mono opacity-90 hover:opacity-100">
              {l}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
