import { ArrowRight } from "lucide-react";
import { ModuleIcon } from "../App";
import { MODULOS, ModuloId } from "../modules/registry";

interface HomePageProps {
  onAbrir: (id: ModuloId) => void;
}

const ACCENTS = {
  amber:
    "from-amber-500/15 to-amber-500/5 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/20",
  sky: "from-sky-500/15 to-sky-500/5 text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-500/20",
  violet:
    "from-violet-500/15 to-violet-500/5 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-500/20",
  emerald:
    "from-emerald-500/15 to-emerald-500/5 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20",
  rose: "from-rose-500/15 to-rose-500/5 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-500/20",
  indigo:
    "from-indigo-500/15 to-indigo-500/5 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/20",
  teal: "from-teal-500/15 to-teal-500/5 text-teal-600 dark:text-teal-400 border-teal-200 dark:border-teal-500/20",
  orange:
    "from-orange-500/15 to-orange-500/5 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-500/20",
  cyan: "from-cyan-500/15 to-cyan-500/5 text-cyan-600 dark:text-cyan-400 border-cyan-200 dark:border-cyan-500/20",
};

export function HomePage({ onAbrir }: HomePageProps) {
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20 mb-2">
          Central de Produção
        </span>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          Ferramentas do PCP
        </h1>
        <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">
          Selecione um módulo abaixo ou use{" "}
          <kbd className="px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-white/10 text-slate-700 dark:text-zinc-300 font-mono text-xs">
            Ctrl+1..7
          </kbd>{" "}
          para alternar rapidamente.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {MODULOS.map((m, idx) => (
          <button
            key={m.id}
            onClick={() => onAbrir(m.id)}
            className="group text-left rounded-2xl bg-white dark:bg-[#151521]/90 border border-slate-200/90 dark:border-white/[0.07] p-5 flex flex-col justify-between hover:border-blue-400 dark:hover:border-blue-500/40 hover:shadow-md dark:hover:bg-[#191928] transition-all duration-200 shadow-sm dark:shadow-lg dark:shadow-black/20 cursor-pointer"
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <div
                  className={`w-11 h-11 rounded-xl bg-gradient-to-br border flex items-center justify-center ${ACCENTS[m.cor]}`}
                >
                  <ModuleIcon id={m.id} className="w-5 h-5" />
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-white/[0.05] text-slate-500 dark:text-zinc-400 border border-slate-200/80 dark:border-white/5">
                  Ctrl+{idx + 1}
                </span>
              </div>

              <h2 className="text-base font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-300 transition-colors">
                {m.nome}
              </h2>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1.5 leading-relaxed">
                {m.descricao}
              </p>
            </div>

            <div className="mt-5 pt-3 border-t border-slate-100 dark:border-white/[0.05] flex items-center justify-between text-xs font-medium text-slate-400 dark:text-zinc-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              <span>{m.grupo}</span>
              <span className="inline-flex items-center gap-1">
                Abrir
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
