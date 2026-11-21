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
    <div className="p-5 h-full flex flex-col gap-3.5 max-w-full">
      <PageHeader
        icon={<Flame className="w-4 h-4 text-slate-700 dark:text-zinc-300" />}
        title="Painel de Calandragem // Fila em Tempo Real"
        badge="SRV-01"
        subtitle="Servidor HTTP Axum embutido na rede local, sincronizado via WebSocket com o Notepad do PCP."
        right={
          <StatusBadge
            active={status.rodando}
            activeText={`ATIVO :${status.porta}`}
            idleText="OFFLINE"
          />
        }
      />

      {erro && (
        <div className="px-3.5 py-2 rounded text-xs font-mono bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-900/60 text-red-700 dark:text-red-400">
          ERRO // {erro}
        </div>
      )}

      {/* Toolbar do Servidor */}
      <SurfaceCard className="p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 font-mono text-xs">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">PORTA HTTP:</span>
          <input
            type="text"
            value={porta}
            disabled={status.rodando}
            onChange={(e) => setPorta(e.target.value)}
            className="w-16 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2 py-1 text-xs text-slate-900 dark:text-white disabled:opacity-50"
          />
        </div>

        <button
          onClick={alternar}
          className={`flex items-center gap-2 px-4 py-1.5 rounded text-xs font-semibold text-white cursor-pointer transition-all ${
            status.rodando
              ? "bg-red-600 hover:bg-red-500 shadow-2xs"
              : "bg-emerald-600 hover:bg-emerald-500 shadow-2xs"
          }`}
        >
          {status.rodando ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          <span>{status.rodando ? "DESLIGAR SERVIDOR" : "LIGAR SERVIDOR"}</span>
        </button>

        <label className="flex items-center gap-2 text-xs font-mono text-slate-700 dark:text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={autoIniciar}
            onChange={(e) => {
              setAutoIniciar(e.target.checked);
              salvarConfig(e.target.checked);
            }}
            className="rounded accent-blue-600"
          />
          <span>Auto-inicializar com o sistema</span>
        </label>

        {status.rodando && status.link && (
          <div className="ml-auto flex items-center gap-2 font-mono text-xs">
            <div className="flex items-center gap-2 bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded px-2.5 py-1">
              <span className="text-blue-700 dark:text-blue-400 select-text">
                {status.link}
              </span>
              <button
                onClick={copiarLink}
                className="text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
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
              className="flex items-center gap-1.5 px-3 py-1 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-800 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-700 text-xs font-semibold cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>ABRIR NO BROWSER</span>
            </button>
          </div>
        )}
      </SurfaceCard>

      {status.rodando ? (
        <div className="flex-1 min-h-0 rounded border border-slate-200 dark:border-zinc-800 overflow-hidden shadow-2xs bg-white">
          <iframe
            src={`http://127.0.0.1:${status.porta}/`}
            title="Painel de Calandragem"
            className="w-full h-full border-0"
          />
        </div>
      ) : (
        <SurfaceCard className="flex-1 flex items-center justify-center p-8 font-mono text-xs text-slate-500 dark:text-zinc-500">
          SERVIDOR DE CALANDRAGEM OFFLINE // CLIQUE EM 'LIGAR SERVIDOR' PARA ATIVAR O ESPELHAMENTO
        </SurfaceCard>
      )}
    </div>
  );
}
