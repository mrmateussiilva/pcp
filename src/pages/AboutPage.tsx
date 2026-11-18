import { ExternalLink, Heart, Info, Layers, Sparkles } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PageHeader, SurfaceCard } from "../components/ui";

const STACK = [
  "Rust",
  "Tauri v2",
  "React 19",
  "TypeScript",
  "Tailwind CSS v4",
  "Axum (HTTP + WS)",
  "Rayon",
  "fast_image_resize (SIMD)",
  "Windows.Data.Pdf",
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
    <div className="p-6 h-full flex flex-col gap-5 max-w-4xl mx-auto">
      <PageHeader
        icon={<Info className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
        title="Sobre o PCP Central"
        subtitle="Central unificada de automação, produção e comunicação para sublimação."
      />

      {/* Hero / Manifesto */}
      <SurfaceCard className="p-7 relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-600/25 shrink-0">
              <Layers className="w-7 h-7 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                  PCP Central
                </h2>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30">
                  v0.1.0 • Rust + Tauri v2
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
                Criado por{" "}
                <span className="font-semibold text-slate-800 dark:text-zinc-200">
                  mrmateussiilva
                </span>
              </p>
            </div>
          </div>

          <button
            onClick={abrirRepo}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90 text-xs font-semibold cursor-pointer transition-opacity self-start sm:self-auto"
          >
            <span>github.com/mrmateussiilva/pcp</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-100 dark:border-white/[0.06] grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200/80 dark:border-white/[0.06] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1">
              <Sparkles className="w-3.5 h-3.5" />
              Filosofia
            </div>
            <p className="text-sm font-medium text-slate-800 dark:text-zinc-100 italic">
              “Bonito é melhor que feio.”
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200/80 dark:border-white/[0.06] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-1">
              <Heart className="w-3.5 h-3.5" />
              Construção
            </div>
            <p className="text-sm font-medium text-slate-800 dark:text-zinc-100 italic">
              “Bit a bit, solução por solução.”
            </p>
          </div>
        </div>
      </SurfaceCard>

      {/* Stack */}
      <SurfaceCard className="p-5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-3">
          Tecnologias Utilizadas
        </h3>
        <div className="flex flex-wrap gap-2">
          {STACK.map((item) => (
            <span
              key={item}
              className="px-3 py-1 rounded-lg text-xs font-medium bg-slate-100 dark:bg-white/[0.05] text-slate-700 dark:text-zinc-300 border border-slate-200/80 dark:border-white/[0.06]"
            >
              {item}
            </span>
          ))}
        </div>
      </SurfaceCard>
    </div>
  );
}
