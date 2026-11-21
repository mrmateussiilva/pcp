import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Eye, EyeOff, MessageSquare, Play, Search, Square, Trash2 } from "lucide-react";
import { PageHeader, StatusBadge, SurfaceCard } from "../components/ui";
import { usePageShortcuts } from "../hooks/useShortcuts";

interface WhatsappConfig {
  porta: number;
  token: string;
  auto_iniciar: boolean;
}

interface ZapStatus {
  rodando: boolean;
  porta: number;
}

interface ZapMensagem {
  hora: string;
  grupo: string;
  autor: string;
  texto: string;
}

const TODOS = "Todos os grupos";
const MAX_MSGS = 3000;

export function WhatsappPage() {
  const [porta, setPorta] = useState("5050");
  const [token, setToken] = useState("");
  const [mostrarToken, setMostrarToken] = useState(false);
  const [autoIniciar, setAutoIniciar] = useState(false);
  const [status, setStatus] = useState<ZapStatus>({ rodando: false, porta: 0 });
  const [mensagens, setMensagens] = useState<ZapMensagem[]>([]);
  const [filtroGrupo, setFiltroGrupo] = useState(TODOS);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const feedRef = useRef<HTMLDivElement | null>(null);
  const buscaRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    invoke<WhatsappConfig>("whatsapp_get_config").then((cfg) => {
      setPorta(String(cfg.porta || 5050));
      setToken(cfg.token || "");
      setAutoIniciar(cfg.auto_iniciar);
    });
    invoke<ZapStatus>("whatsapp_status").then(setStatus);
    invoke<ZapMensagem[]>("whatsapp_historico").then(setMensagens);

    const unStatus = listen<ZapStatus>("whatsapp-status", (e) => setStatus(e.payload));
    const unMsg = listen<ZapMensagem>("whatsapp-mensagem", (e) => {
      setMensagens((prev) => {
        const next = [...prev, e.payload];
        return next.length > MAX_MSGS ? next.slice(-MAX_MSGS) : next;
      });
    });

    return () => {
      unStatus.then((fn) => fn());
      unMsg.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [mensagens, filtroGrupo, busca]);

  const salvarConfig = async (novoAuto = autoIniciar) => {
    const portaNum = Number(porta) || 5050;
    await invoke("whatsapp_save_config", {
      payload: { porta: portaNum, token, auto_iniciar: novoAuto },
    });
  };

  const alternar = async () => {
    setErro(null);
    try {
      if (status.rodando) {
        const st = await invoke<ZapStatus>("whatsapp_parar");
        setStatus(st);
      } else {
        const portaNum = Number(porta);
        if (!portaNum || portaNum < 1 || portaNum > 65535) {
          setErro("Porta inválida.");
          return;
        }
        const st = await invoke<ZapStatus>("whatsapp_iniciar", {
          porta: portaNum,
          token,
          autoIniciar,
        });
        setStatus(st);
      }
    } catch (e) {
      setErro(String(e));
    }
  };

  const limpar = async () => {
    await invoke("whatsapp_limpar");
    setMensagens([]);
    setFiltroGrupo(TODOS);
  };

  usePageShortcuts([
    { id: "zap-toggle", combo: "ctrl+enter", keys: "Ctrl+Enter", label: status.rodando ? "Parar Webhook WhatsApp" : "Iniciar Webhook WhatsApp", action: alternar },
    { id: "zap-search", combo: "ctrl+f", keys: "Ctrl+F", label: "Focar Filtro de Mensagens", action: () => { buscaRef.current?.focus(); buscaRef.current?.select(); } },
    { id: "zap-clear", combo: "ctrl+l", keys: "Ctrl+L", label: "Limpar Histórico de Mensagens", action: limpar },
  ]);

  const contagemGrupos = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of mensagens) {
      map.set(m.grupo, (map.get(m.grupo) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[0].toLowerCase().localeCompare(b[0].toLowerCase())
    );
  }, [mensagens]);

  const mensagensFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return mensagens.filter((m) => {
      if (filtroGrupo !== TODOS && m.grupo !== filtroGrupo) return false;
      if (!termo) return true;
      return `${m.autor} ${m.texto} ${m.grupo}`.toLowerCase().includes(termo);
    });
  }, [mensagens, filtroGrupo, busca]);

  return (
    <div className="p-5 h-full flex flex-col gap-3.5 max-w-7xl mx-auto">
      <PageHeader
        icon={<MessageSquare className="w-4 h-4 text-slate-700 dark:text-zinc-300" />}
        title="WhatsApp Live Hook // Evolution Go"
        badge="SRV-03"
        subtitle="Webhook HTTP receiver (:5050) para notificações de pedidos e confirmações de arte ao vivo."
        right={
          <StatusBadge
            active={status.rodando}
            activeText={`OUVINDO :${status.porta}`}
            idleText="OFFLINE"
          />
        }
      />

      {erro && (
        <div className="px-3.5 py-2 rounded text-xs font-mono bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-900/60 text-red-700 dark:text-red-400">
          ERRO // {erro}
        </div>
      )}

      {/* Toolbar */}
      <SurfaceCard className="p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">PORTA:</span>
          <input
            type="text"
            value={porta}
            disabled={status.rodando}
            onChange={(e) => setPorta(e.target.value)}
            className="w-16 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2 py-1 text-xs text-slate-900 dark:text-white disabled:opacity-50"
          />
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">TOKEN:</span>
          <div className="relative flex items-center">
            <input
              type={mostrarToken ? "text" : "password"}
              value={token}
              disabled={status.rodando}
              onChange={(e) => setToken(e.target.value)}
              placeholder="EVO_TOKEN"
              className="w-48 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 pl-2.5 pr-7 py-1 text-xs text-slate-900 dark:text-white disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => setMostrarToken((v) => !v)}
              className="absolute right-2 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
            >
              {mostrarToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs font-mono text-slate-700 dark:text-zinc-300 cursor-pointer px-1">
          <input
            type="checkbox"
            checked={autoIniciar}
            onChange={(e) => {
              setAutoIniciar(e.target.checked);
              salvarConfig(e.target.checked);
            }}
            className="rounded accent-blue-600"
          />
          <span>Auto-start</span>
        </label>

        <button
          onClick={alternar}
          className={`ml-auto flex items-center gap-2 px-4 py-1.5 rounded text-xs font-semibold text-white cursor-pointer transition-all ${
            status.rodando
              ? "bg-red-600 hover:bg-red-500 shadow-2xs"
              : "bg-emerald-600 hover:bg-emerald-500 shadow-2xs"
          }`}
        >
          {status.rodando ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          <span>{status.rodando ? "DESLIGAR" : "INICIAR RECEPTOR"}</span>
        </button>
      </SurfaceCard>

      <div className="flex-1 min-h-0 grid grid-cols-[230px_1fr] gap-3.5">
        {/* Grupos do WhatsApp */}
        <SurfaceCard className="p-3 flex flex-col min-h-0">
          <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 pb-2 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between">
            <span>GRUPOS ATIVOS</span>
            <span>{contagemGrupos.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-0.5 pt-2 pr-0.5">
            <button
              onClick={() => setFiltroGrupo(TODOS)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs font-mono text-left cursor-pointer transition-colors ${
                filtroGrupo === TODOS
                  ? "bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900 font-bold shadow-2xs"
                  : "text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800/60"
              }`}
            >
              <span className="truncate">{TODOS}</span>
              <span className="text-[10px] opacity-75 tabular-nums">
                {mensagens.length}
              </span>
            </button>

            {contagemGrupos.map(([nome, count]) => (
              <button
                key={nome}
                onClick={() => setFiltroGrupo(nome)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs font-mono text-left cursor-pointer transition-colors ${
                  filtroGrupo === nome
                    ? "bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900 font-bold shadow-2xs"
                    : "text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800/60"
                }`}
              >
                <span className="truncate">{nome}</span>
                <span className="text-[10px] opacity-75 tabular-nums">
                  {count}
                </span>
              </button>
            ))}
          </div>
        </SurfaceCard>

        {/* Feed de Mensagens */}
        <SurfaceCard className="p-3 flex flex-col min-h-0">
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-100 dark:border-zinc-800">
            <span className="font-mono text-xs font-bold text-slate-900 dark:text-white uppercase truncate">
              {filtroGrupo}
            </span>

            <div className="flex items-center gap-2">
              <button
                onClick={limpar}
                className="flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-xs font-mono text-slate-700 dark:text-zinc-300 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                <span>LIMPAR</span>
              </button>

              <div className="relative flex items-center">
                <Search className="w-3 h-3 text-slate-400 absolute left-2" />
                <input
                  ref={buscaRef}
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="FILTRAR FEED... (Ctrl+F)"
                  className="w-48 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 pl-7 pr-2 py-1 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          <div
            ref={feedRef}
            className="flex-1 overflow-y-auto rounded border border-slate-200 dark:border-zinc-800 bg-slate-900 dark:bg-[#070709] p-3 font-mono text-xs space-y-1.5 select-text leading-relaxed mt-2"
          >
            {mensagensFiltradas.length === 0 ? (
              <div className="text-slate-500 dark:text-zinc-600 text-center py-10 font-mono">
                AGUARDANDO MENSAGENS DO WEBHOOK...
              </div>
            ) : (
              mensagensFiltradas.map((m, i) => (
                <div key={i} className="break-words font-mono text-[11px] opacity-90 hover:opacity-100">
                  <span className="text-slate-400 dark:text-zinc-500">[{m.hora}] </span>
                  {filtroGrupo === TODOS && (
                    <span className="text-sky-400 font-semibold">[{m.grupo}] </span>
                  )}
                  <span className="text-emerald-400 font-bold">{m.autor}: </span>
                  <span className="text-slate-200">{m.texto}</span>
                </div>
              ))
            )}
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}
