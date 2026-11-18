import { ModuloMeta } from "../modules/registry";

export function EmConstrucaoPage({ modulo }: { modulo: ModuloMeta }) {
  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-3xl">{modulo.icone}</span>
        <h1 className="text-2xl font-bold text-white">{modulo.nome}</h1>
      </div>
      <p className="text-sm text-zinc-400 mb-6">{modulo.descricao}</p>

      <div className="rounded-xl bg-[#1e1e2e] border border-amber-500/20 p-6">
        <p className="text-sm text-amber-300 font-medium">
          Módulo previsto nas próximas etapas do plano de migração.
        </p>
        <p className="text-xs text-zinc-400 mt-2">
          Enquanto isso, a versão Python em <code className="text-zinc-200">hub/</code> continua disponível sem alterações.
        </p>
      </div>
    </div>
  );
}
