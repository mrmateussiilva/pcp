import { ModuloMeta } from "../modules/registry";
import { ModuleIcon } from "../App";
import { PageHeader, SurfaceCard } from "../components/ui";

export function EmConstrucaoPage({ modulo }: { modulo: ModuloMeta }) {
  return (
    <div className="p-6 h-full flex flex-col gap-4 max-w-4xl mx-auto">
      <PageHeader
        icon={<ModuleIcon id={modulo.id} className="w-4 h-4" />}
        title={modulo.nome}
        badge={modulo.codigo}
        subtitle={modulo.descricao}
      />
      <SurfaceCard className="p-10 flex flex-col items-center justify-center text-center gap-3">
        <div className="w-12 h-12 rounded border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 flex items-center justify-center">
          <ModuleIcon id={modulo.id} className="w-6 h-6 text-slate-600 dark:text-zinc-400" />
        </div>
        <div className="font-mono text-sm font-semibold text-slate-900 dark:text-zinc-100">
          MÓDULO EM DESENVOLVIMENTO
        </div>
        <p className="text-xs text-slate-500 dark:text-zinc-400 max-w-md">
          {modulo.descricao}
        </p>
      </SurfaceCard>
    </div>
  );
}
