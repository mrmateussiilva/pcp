import { ChevronRight, HardDrive, Server } from "lucide-react";
import { ModuleIcon, StatusInfo } from "../App";
import { MODULOS, ModuloId } from "../modules/registry";
import { SurfaceCard } from "../components/ui";

interface HomePageProps {
  onAbrir: (id: ModuloId) => void;
  statusMap: Partial<Record<ModuloId, StatusInfo>>;
  driveBase: string;
}

export function HomePage({ onAbrir, statusMap, driveBase }: HomePageProps) {
  const agora = new Date();
  const dataFormatada = agora.toLocaleDateString("pt-BR", {
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const GRUPOS = ["DIA A DIA", "PRODUÇÃO", "COMUNICAÇÃO"] as const;
  const modulosAtivos = Object.keys(statusMap).length;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Barra de Telemetria de Entrada */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-zinc-100 uppercase">
              Centro de Operação // PCP Central
            </h1>
          </div>
          <p className="text-xs font-mono text-slate-500 dark:text-zinc-400 mt-0.5 capitalize">
            {dataFormatada} • Base Operacional: <span className="text-slate-800 dark:text-zinc-200 font-semibold">{driveBase}</span>
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111115]">
            <Server className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-500 dark:text-zinc-400">SERVIÇOS:</span>
            <span className="font-bold text-slate-900 dark:text-zinc-100">{modulosAtivos} ATIVO(S)</span>
          </div>

          <button
            onClick={() => onAbrir("pastas")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-blue-600 bg-blue-600 hover:bg-blue-500 text-white font-medium cursor-pointer transition-colors shadow-2xs"
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>ESTRUTURAR DIA</span>
          </button>
        </div>
      </div>

      {/* Matriz de Bancadas Operacionais */}
      <div className="space-y-4">
        {GRUPOS.map((grupo) => {
          const itens = MODULOS.filter((m) => m.grupo === grupo);
          return (
            <SurfaceCard key={grupo} className="overflow-hidden">
              <div className="px-4 py-2 bg-slate-50 dark:bg-zinc-900/40 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between text-xs">
                <span className="font-mono font-bold tracking-wider text-slate-600 dark:text-zinc-400 uppercase flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-xs bg-slate-400 dark:bg-zinc-600" />
                  BANCADA: {grupo}
                </span>
                <span className="text-[10px] font-mono text-slate-400 dark:text-zinc-500">
                  {itens.length} FERRAMENTAS
                </span>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-zinc-800/60">
                {itens.map((m) => {
                  const globalIdx = MODULOS.findIndex((x) => x.id === m.id) + 1;
                  const st = statusMap[m.id];
                  return (
                    <div
                      key={m.id}
                      onClick={() => onAbrir(m.id)}
                      className="group px-4 py-3 flex items-center justify-between gap-4 hover:bg-slate-50/80 dark:hover:bg-zinc-800/30 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="w-8 h-8 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900 flex items-center justify-center text-slate-700 dark:text-zinc-300 shrink-0 group-hover:border-slate-400 dark:group-hover:border-zinc-600 transition-colors">
                          <ModuleIcon id={m.id} className="w-4 h-4" />
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-slate-400 dark:text-zinc-500 font-semibold">
                              {m.codigo}
                            </span>
                            <span className="text-xs font-bold text-slate-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                              {m.nome}
                            </span>
                            <span className="text-[9px] font-mono px-1 py-0.2 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 text-slate-500 dark:text-zinc-400">
                              {m.tipo}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-zinc-400 truncate mt-0.5 max-w-xl">
                            {m.descricao}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0 font-mono text-xs">
                        {st ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-emerald-300 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            {st.text}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400 dark:text-zinc-600 font-medium">
                            STANDBY
                          </span>
                        )}

                        <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900 text-slate-500 dark:text-zinc-400">
                          Ctrl+{globalIdx}
                        </kbd>

                        <ChevronRight className="w-4 h-4 text-slate-300 dark:text-zinc-700 group-hover:text-slate-600 dark:group-hover:text-zinc-300 transition-colors" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </SurfaceCard>
          );
        })}
      </div>
    </div>
  );
}
