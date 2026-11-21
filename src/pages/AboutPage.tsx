import { ExternalLink, Info, Terminal } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PageHeader, SurfaceCard } from "../components/ui";

const SPECS = [
  { item: "RUNTIME ENGINE", valor: "Rust (Tauri v2 Shell / Staticlib)" },
  { item: "IPC INTERFACE", valor: "Tauri IPC Command Router" },
  { item: "GRAPHICS ACCELERATION", valor: "SIMD via fast_image_resize + Rayon Thread Pool" },
  { item: "IMAGE PROCESSING", valor: "TIFF 0.9 Single-Open / ICC Profile Tag 34675 / LZW" },
  { item: "NETWORKING SERVICES", valor: "Axum Tokio (HTTP + WebSocket Engine)" },
  { item: "WINDOWS NATIVE API", valor: "Windows.Data.Pdf (WinRT Direct Render)" },
  { item: "FRONTEND STACK", valor: "React 19 + TypeScript + Vite + Tailwind CSS v4" },
  { item: "STORAGE ARCHITECTURE", valor: "Atomic Write (.json.tmp + Rename Strategy)" },
];

export function AboutPage() {
  const abrirRepo = async () => {
    try {
      await openUrl("https://github.com/mrmateussiilva/pcp");
    } catch {
      window.open("https://github.com/mrmateussiilva/pcp", "_blank");
    }
  };

  return (
    <div className="p-5 h-full flex flex-col gap-4 max-w-4xl mx-auto">
      <PageHeader
        icon={<Info className="w-4 h-4 text-slate-700 dark:text-zinc-300" />}
        title="Especificações Técnicas // Sobre o PCP Central"
        badge="SYS-INFO"
        subtitle="Estação de trabalho nativa em Rust + Tauri v2 para automação de sublimação e acabamento têxtil."
      />

      {/* Identificação de Engenharia */}
      <SurfaceCard className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded border border-slate-400 dark:border-zinc-700 bg-slate-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-slate-900 shrink-0">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-white uppercase tracking-tight">
                  PCP Central Workstation
                </h2>
                <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400">
                  BUILD 2026.11
                </span>
              </div>
              <p className="font-mono text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                Desenvolvido por mrmateussiilva // Sublimação & PCP
              </p>
            </div>
          </div>

          <button
            onClick={abrirRepo}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 hover:bg-slate-50 dark:hover:bg-zinc-700 text-xs font-mono font-semibold cursor-pointer transition-colors"
          >
            <span>GITHUB REPO</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Ficha Técnica */}
        <div className="pt-4 space-y-2">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-2">
            ESPECIFICAÇÕES DO KERNEL & DEPENDÊNCIAS
          </div>
          <div className="divide-y divide-slate-100 dark:divide-zinc-800/60 border border-slate-200 dark:border-zinc-800 rounded bg-slate-50 dark:bg-zinc-950/60 font-mono text-xs">
            {SPECS.map((s) => (
              <div key={s.item} className="flex flex-col sm:flex-row sm:items-center justify-between px-3 py-2 gap-1">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">{s.item}</span>
                <span className="text-slate-800 dark:text-zinc-200 font-bold">{s.valor}</span>
              </div>
            ))}
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
