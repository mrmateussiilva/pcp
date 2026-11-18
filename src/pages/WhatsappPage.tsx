import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Eye, EyeOff, MessageSquare, Play, Search, Square, Trash2 } from "lucide-react";
import { PageHeader, StatusBadge, SurfaceCard } from "../components/ui";

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
    <div className="p-6 h-full flex flex-col gap-4 max-w-7xl mx-auto">
      <PageHeader
        icon={<MessageSquare className="w-5 h-5 text-teal-600 dark:text-teal-400" />}
        title="WhatsApp — Grupos"
        subtitle="Recebe o webhook do Evolution Go e mostra as mensagens dos grupos ao vivo."
        right={
          <StatusBadge
            active={status.rodando}
            activeText={`Ouvindo :${status.porta}`}
            idleText="Desligado"
          />
        }
      />

      {erro && (
        <div className="px-4 py-2.5 rounded-xl text-xs bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300">
          {erro}
        </div>
      )}

      <SurfaceCard className="p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-zinc-400">Porta</span>
          <input
            type="text"
            value={porta}
            disabled={status.rodando}
            onChange={(e) => setPorta(e.target.value)}
            className="w-20 rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs text-slate-900 dark:text-white disabled:opacity-50"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-zinc-400">Token</span>
          <div className="relative flex items-center">
            <input
              type={mostrarToken ? "text" : "password"}
              value={token}
              disabled={status.rodando}
              onChange={(e) => setToken(e.target.value)}
              placeholder="EVO_TOKEN"
              className="w-56 rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 pl-3 pr-8 py-1.5 text-xs text-slate-900 dark:text-white disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => setMostrarToken((v) => !v)}
              className="absolute right-2.5 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
            >
              {mostrarToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-zinc-200 cursor-pointer px-1">
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

        <button
          onClick={alternar}
          className={`ml-auto flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-semibold text-white cursor-pointer transition-all ${
            status.rodando
              ? "bg-red-600 hover:bg-red-500 shadow-sm"
              : "bg-emerald-600 hover:bg-emerald-500 shadow-sm"
          }`}
        >
          {status.rodando ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {status.rodando ? "Desligar" : "Ligar"}
        </button>
      </SurfaceCard>

      <div className="flex-1 min-h-0 grid grid-cols-[240px_1fr] gap-3.5">
        <SurfaceCard className="p-3 flex flex-col min-h-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-400 px-2 pb-2">
            Grupos
          </div>
          <div className="flex-1 overflow-y-auto space-y-1">
            <button
              onClick={() => setFiltroGrupo(TODOS)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-left cursor-pointer transition-colors ${
                filtroGrupo === TODOS
                  ? "bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-white font-semibold border border-blue-200 dark:border-blue-500/30"
                  : "text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-white/[0.04]"
              }`}
            >
              <span className="truncate">{TODOS}</span>
              <span className="text-slate-400 dark:text-zinc-400 ml-2 tabular-nums">
                {mensagens.length}
              </span>
            </button>

            {contagemGrupos.map(([nome, count]) => (
              <button
                key={nome}
                onClick={() => setFiltroGrupo(nome)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-left cursor-pointer transition-colors ${
                  filtroGrupo === nome
                    ? "bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-white font-semibold border border-blue-200 dark:border-blue-500/30"
                    : "text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-white/[0.04]"
                }`}
              >
                <span className="truncate">{nome}</span>
                <span className="text-slate-400 dark:text-zinc-400 ml-2 tabular-nums">
                  {count}
                </span>
              </button>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-3.5 flex flex-col min-h-0">
          <div className="flex items-center justify-between gap-2 pb-3">
            <span className="text-sm font-bold text-slate-900 dark:text-white truncate">
              {filtroGrupo}
            </span>

            <div className="flex items-center gap-2">
              <button
                onClick={limpar}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-white/[0.07] hover:bg-slate-200 dark:hover:bg-white/15 text-xs text-slate-700 dark:text-zinc-200 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Limpar
              </button>

              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-400 absolute left-3" />
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar..."
                  className="w-56 rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          <div
            ref={feedRef}
            className="flex-1 overflow-y-auto rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/[0.06] p-3.5 font-mono text-xs space-y-1.5 select-text leading-relaxed"
          >
            {mensagensFiltradas.length === 0 ? (
              <div className="text-slate-400 dark:text-zinc-600 text-center py-10">
                Nenhuma mensagem recebida ainda.
              </div>
            ) : (
              mensagensFiltradas.map((m, i) => (
                <div key={i} className="break-words">
                  <span className="text-slate-400 dark:text-zinc-500">{m.hora}  </span>
                  {filtroGrupo === TODOS && (
                    <span className="text-sky-600 dark:text-sky-400">[{m.grupo}] </span>
                  )}
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    {m.autor}:{" "}
                  </span>
                  <span className="text-slate-800 dark:text-zinc-200">{m.texto}</span>
                </div>
              ))
            )}
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}
