import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy, ExternalLink, Flame, Play, Square } from "lucide-react";
import { PageHeader, StatusBadge, SurfaceCard } from "../components/ui";

interface CalandragemConfig {
  porta: number;
  auto_iniciar: boolean;
}

interface CalandragemStatus {
  rodando: boolean;
  porta: number;
  link: string;
}

export function CalandragemPage() {
  const [porta, setPorta] = useState("8767");
  const [autoIniciar, setAutoIniciar] = useState(true);
  const [status, setStatus] = useState<CalandragemStatus>({
    rodando: false,
    porta: 0,
    link: "",
  });
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    invoke<CalandragemConfig>("calandragem_get_config").then((cfg) => {
      setPorta(String(cfg.porta || 8767));
      setAutoIniciar(cfg.auto_iniciar);
    });
    invoke<CalandragemStatus>("calandragem_status").then(setStatus);

    const un = listen<CalandragemStatus>("calandragem-status", (e) => {
      setStatus(e.payload);
    });
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  const salvarConfig = async (novoAuto = autoIniciar) => {
    await invoke("calandragem_save_config", {
      payload: {
        porta: Number(porta) || 8767,
        auto_iniciar: novoAuto,
      },
    });
  };

  const alternar = async () => {
    setErro(null);
    try {
      if (status.rodando) {
        const st = await invoke<CalandragemStatus>("calandragem_parar");
        setStatus(st);
      } else {
        const p = Number(porta);
        if (!p || p < 1 || p > 65535) {
          setErro("Porta inválida.");
          return;
        }
        const st = await invoke<CalandragemStatus>("calandragem_iniciar", {
          porta: p,
          autoIniciar,
        });
        setStatus(st);
      }
    } catch (e) {
      setErro(String(e));
    }
  };

  const copiarLink = async () => {
    if (!status.link) return;
    await navigator.clipboard.writeText(status.link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  };

  const abrirNavegador = async () => {
    if (!status.link) return;
    try {
      await openUrl(status.link);
    } catch {
      window.open(status.link, "_blank");
    }
  };

  return (
    <div className="p-6 h-full flex flex-col gap-3.5 max-w-full">
      <PageHeader
        icon={<Flame className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />}
        title="Painel de Calandragem"
        subtitle="Embutido no PCP Central e acessível por URL em qualquer navegador da rede local."
        right={
          <StatusBadge
            active={status.rodando}
            activeText={`Ativo :${status.porta}`}
            idleText="Desligado"
          />
        }
      />

      {erro && (
        <div className="px-4 py-2.5 rounded-xl text-xs bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300">
          {erro}
        </div>
      )}

      <SurfaceCard className="p-3.5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500 dark:text-zinc-400">Porta HTTP</span>
          <input
            type="text"
            value={porta}
            disabled={status.rodando}
            onChange={(e) => setPorta(e.target.value)}
            className="w-20 rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-2.5 py-1.5 text-xs text-slate-900 dark:text-white disabled:opacity-50"
          />
        </div>

        <button
          onClick={alternar}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-semibold text-white cursor-pointer transition-all ${
            status.rodando
              ? "bg-red-600 hover:bg-red-500 shadow-sm"
              : "bg-emerald-600 hover:bg-emerald-500 shadow-sm"
          }`}
        >
          {status.rodando ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {status.rodando ? "Desligar" : "Ligar"}
        </button>

        <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-zinc-200 cursor-pointer">
          <input
            type="checkbox"
            checked={autoIniciar}
            onChange={(e) => {
              setAutoIniciar(e.target.checked);
              salvarConfig(e.target.checked);
            }}
            className="rounded accent-blue-600"
          />
          Ligar ao abrir
        </label>

        {status.rodando && status.link && (
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-2 bg-blue-50 dark:bg-[#0b0b12] border border-blue-200 dark:border-white/10 rounded-xl px-3 py-1.5">
              <span className="text-xs text-blue-700 dark:text-blue-400 font-mono select-text">
                {status.link}
              </span>
              <button
                onClick={copiarLink}
                className="text-blue-600 dark:text-zinc-400 hover:text-blue-800 dark:hover:text-white cursor-pointer"
                title="Copiar URL"
              >
                {copiado ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            <button
              onClick={abrirNavegador}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90 text-xs font-semibold cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Abrir no navegador
            </button>
          </div>
        )}
      </SurfaceCard>

      {status.rodando ? (
        <div className="flex-1 min-h-0 rounded-2xl overflow-hidden border border-slate-200 dark:border-white/10 shadow-sm bg-white">
          <iframe
            src={`http://127.0.0.1:${status.porta}/`}
            title="Painel de Calandragem"
            className="w-full h-full border-0"
          />
        </div>
      ) : (
        <SurfaceCard className="flex-1 flex items-center justify-center p-10">
          <div className="text-center text-sm text-slate-500 dark:text-zinc-400">
            Ligue o servidor acima para usar o Painel de Calandragem aqui ou no navegador.
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}
