import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowDown,
  Copy,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Image,
  MessageSquare,
  Mic,
  Play,
  Search,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import {
  PageHeader,
  StatCard,
  StatusBadge,
  SurfaceCard,
} from "../components/ui";
import { usePageShortcuts } from "../hooks/useShortcuts";

interface WhatsappConfig {
  porta: number;
  token: string;
  auto_iniciar: boolean;
}

interface ZapStatus {
  rodando: boolean;
  porta: number;
  link_webhook: string;
  total_mensagens: number;
  total_grupos: number;
  ultima_mensagem_hora?: string | null;
}

interface ZapMensagem {
  id: string;
  hora: string;
  grupo: string;
  autor: string;
  texto: string;
  tipo_midia: string;
}

const TODOS = "Todos os grupos";
const MAX_MSGS = 3000;

export function WhatsappPage() {
  const [porta, setPorta] = useState("5050");
  const [token, setToken] = useState("");
  const [mostrarToken, setMostrarToken] = useState(false);
  const [autoIniciar, setAutoIniciar] = useState(false);
  const [status, setStatus] = useState<ZapStatus>({
    rodando: false,
    porta: 0,
    link_webhook: "",
    total_mensagens: 0,
    total_grupos: 0,
    ultima_mensagem_hora: null,
  });
  const [mensagens, setMensagens] = useState<ZapMensagem[]>([]);
  const [filtroGrupo, setFiltroGrupo] = useState(TODOS);
  const [buscaGrupo, setBuscaGrupo] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<"todos" | "texto" | "imagem" | "documento" | "audio">("todos");
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [copiadoUrl, setCopiadoUrl] = useState(false);
  const [copiadoFeed, setCopiadoFeed] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

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

  // Controla scroll do feed
  useEffect(() => {
    if (autoScroll && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [mensagens, filtroGrupo, busca, filtroTipo, autoScroll]);

  const handleFeedScroll = () => {
    if (!feedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
    // Se estiver a menos de 40px do fundo, mantém auto-scroll ativo
    const estaNoFim = scrollHeight - (scrollTop + clientHeight) < 40;
    setAutoScroll(estaNoFim);
  };

  const rolarParaFim = () => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
      setAutoScroll(true);
    }
  };

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

  const injetarTeste = async () => {
    try {
      await invoke("whatsapp_injetar_teste");
    } catch (e) {
      setErro(String(e));
    }
  };

  const limpar = async () => {
    if (
      mensagens.length > 0 &&
      !window.confirm("Limpar todo o histórico de mensagens capturadas do WhatsApp?")
    ) {
      return;
    }
    await invoke("whatsapp_limpar");
    setMensagens([]);
    setFiltroGrupo(TODOS);
  };

  const copiarUrlWebhook = async () => {
    if (!status.link_webhook) return;
    await navigator.clipboard.writeText(status.link_webhook);
    setCopiadoUrl(true);
    setTimeout(() => setCopiadoUrl(false), 1800);
  };

  const copiarFeed = async () => {
    if (mensagensFiltradas.length === 0) return;
    const texto = mensagensFiltradas
      .map((m) => `[${m.hora}] [${m.grupo}] ${m.autor}: ${m.texto}`)
      .join("\n");
    await navigator.clipboard.writeText(texto);
    setCopiadoFeed(true);
    setTimeout(() => setCopiadoFeed(false), 1500);
  };

  const copiarMensagem = async (texto: string) => {
    await navigator.clipboard.writeText(texto);
  };

  usePageShortcuts([
    {
      id: "zap-toggle",
      combo: "ctrl+enter",
      keys: "Ctrl+Enter",
      label: status.rodando ? "Parar Webhook WhatsApp" : "Iniciar Webhook WhatsApp",
      action: alternar,
    },
    {
      id: "zap-search",
      combo: "ctrl+f",
      keys: "Ctrl+F",
      label: "Focar Filtro de Mensagens",
      action: () => {
        buscaRef.current?.focus();
        buscaRef.current?.select();
      },
    },
    { id: "zap-clear", combo: "ctrl+l", keys: "Ctrl+L", label: "Limpar Histórico", action: limpar },
    { id: "zap-test", combo: "alt+t", keys: "Alt+T", label: "Simular Mensagem de Teste", action: injetarTeste },
    { id: "zap-copy-url", combo: "ctrl+shift+c", keys: "Ctrl+Shift+C", label: "Copiar URL Webhook", action: copiarUrlWebhook },
  ]);

  // Contagem de grupos com busca
  const contagemGrupos = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of mensagens) {
      map.set(m.grupo, (map.get(m.grupo) || 0) + 1);
    }
    const lista = Array.from(map.entries()).sort((a, b) =>
      a[0].toLowerCase().localeCompare(b[0].toLowerCase())
    );
    if (!buscaGrupo.trim()) return lista;
    const q = buscaGrupo.toLowerCase();
    return lista.filter(([nome]) => nome.toLowerCase().includes(q));
  }, [mensagens, buscaGrupo]);

  // Filtro de mensagens
  const mensagensFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return mensagens.filter((m) => {
      if (filtroGrupo !== TODOS && m.grupo !== filtroGrupo) return false;
      if (filtroTipo !== "todos" && m.tipo_midia !== filtroTipo) return false;
      if (!termo) return true;
      return `${m.autor} ${m.texto} ${m.grupo}`.toLowerCase().includes(termo);
    });
  }, [mensagens, filtroGrupo, filtroTipo, busca]);

  return (
    <div className="p-5 h-full flex flex-col gap-3.5 max-w-7xl mx-auto overflow-y-auto">
      {/* Cabeçalho */}
      <PageHeader
        icon={<MessageSquare className="w-4 h-4 text-slate-700 dark:text-zinc-300" />}
        title="WhatsApp Live Hook // Evolution Go"
        badge="SRV-03"
        subtitle="Receptor HTTP Axum capturando eventos, pedidos, fotos de artes e mensagens de grupos em tempo real."
        right={
          <StatusBadge
            active={status.rodando}
            activeText={`OUVINDO :${status.porta}`}
            idleText="OFFLINE"
          />
        }
      />

      {erro && (
        <div className="px-3.5 py-2.5 rounded text-xs font-mono bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-900/60 text-red-700 dark:text-red-400 flex items-center justify-between">
          <span>ERRO // {erro}</span>
          <button onClick={() => setErro(null)} className="text-[10px] uppercase font-bold hover:underline cursor-pointer">
            Fechar
          </button>
        </div>
      )}

      {/* KPIs Industriais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Status do Receptor"
          value={status.rodando ? "ONLINE" : "STANDBY"}
          unit={status.rodando ? `Porta :${status.porta}` : "desligado"}
          tone={status.rodando ? "emerald" : "zinc"}
        />

        <StatCard
          label="Grupos Monitorados"
          value={contagemGrupos.length}
          unit="conversas ativas"
          tone="sky"
        />

        <StatCard
          label="Total no Buffer"
          value={mensagens.length}
          unit={`max ${MAX_MSGS}`}
          tone="zinc"
        />

        <StatCard
          label="Último Evento"
          value={status.ultima_mensagem_hora || (mensagens.length > 0 ? mensagens[mensagens.length - 1].hora : "—")}
          unit={status.rodando ? "tempo real" : "parado"}
          tone={status.rodando ? "blue" : "zinc"}
        />
      </div>

      {/* Toolbar do Receptor */}
      <SurfaceCard className="p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">PORTA:</span>
              <input
                type="text"
                value={porta}
                disabled={status.rodando}
                onChange={(e) => setPorta(e.target.value)}
                className="w-16 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2 py-1 text-xs text-slate-900 dark:text-white disabled:opacity-50 text-center font-bold"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">TOKEN:</span>
              <div className="relative flex items-center">
                <input
                  type={mostrarToken ? "text" : "password"}
                  value={token}
                  disabled={status.rodando}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="EVO_TOKEN (opcional)"
                  className="w-48 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 pl-2.5 pr-7 py-1 text-xs text-slate-900 dark:text-white disabled:opacity-50 focus:outline-none focus:border-blue-500"
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

            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-zinc-300 cursor-pointer">
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
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded text-xs font-bold text-white cursor-pointer transition-all shadow-2xs uppercase ${
                status.rodando
                  ? "bg-red-600 hover:bg-red-500 border border-red-700"
                  : "bg-emerald-600 hover:bg-emerald-500 border border-emerald-700"
              }`}
            >
              {status.rodando ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{status.rodando ? "DESLIGAR" : "INICIAR RECEPTOR"}</span>
            </button>

            <button
              onClick={injetarTeste}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-300 font-mono text-xs cursor-pointer"
              title="Simular mensagem recebida (Alt+T)"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>TESTAR HOOK</span>
            </button>
          </div>

          {/* URL do Webhook para configuração no Evolution */}
          {status.rodando && status.link_webhook && (
            <div className="flex items-center gap-2 bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded px-2.5 py-1">
              <span className="text-[10px] text-slate-500 uppercase font-semibold">WEBHOOK:</span>
              <span className="text-blue-700 dark:text-blue-400 font-bold select-all">
                {status.link_webhook}
              </span>
              <button
                onClick={copiarUrlWebhook}
                className="text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer p-0.5"
                title="Copiar URL para configurar na Evolution API (Ctrl+Shift+C)"
              >
                {copiadoUrl ? (
                  <span className="text-[10px] text-emerald-600 font-bold">COPIADO!</span>
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          )}
        </div>
      </SurfaceCard>

      {/* Conteúdo Principal Dividido */}
      <div className="flex-1 min-h-[460px] grid grid-cols-1 md:grid-cols-12 gap-3.5">
        {/* Coluna 1: Grupos e Filtros (4 colunas) */}
        <SurfaceCard className="p-3.5 flex flex-col min-h-0 md:col-span-4">
          <div className="font-mono text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white pb-2 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between">
            <span>GRUPOS ATIVOS</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400">
              {contagemGrupos.length}
            </span>
          </div>

          {/* Busca de Grupos */}
          <div className="relative mt-2 mb-2">
            <Search className="w-3 h-3 text-slate-400 absolute left-2 top-2" />
            <input
              type="text"
              value={buscaGrupo}
              onChange={(e) => setBuscaGrupo(e.target.value)}
              placeholder="Filtrar grupos..."
              className="w-full rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 pl-7 pr-2 py-1 font-mono text-[11px] text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Filtro por tipo de mídia */}
          <div className="pb-2 border-b border-slate-100 dark:border-zinc-800 mb-2">
            <span className="font-mono text-[10px] font-semibold text-slate-400 dark:text-zinc-500 uppercase block mb-1.5">
              FILTRAR POR TIPO:
            </span>
            <div className="flex flex-wrap gap-1 font-mono text-[10px]">
              {(["todos", "texto", "imagem", "documento", "audio"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setFiltroTipo(t)}
                  className={`px-2 py-0.5 rounded cursor-pointer uppercase ${
                    filtroTipo === t
                      ? "bg-blue-600 text-white font-bold"
                      : "bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-700"
                  }`}
                >
                  {t === "imagem" ? "Foto" : t === "documento" ? "Doc" : t}
                </button>
              ))}
            </div>
          </div>

          {/* Lista de Grupos */}
          <div className="flex-1 overflow-y-auto space-y-1 pr-0.5 min-h-[220px]">
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
                <span className="text-[10px] opacity-75 tabular-nums font-semibold">
                  {count}
                </span>
              </button>
            ))}
          </div>
        </SurfaceCard>

        {/* Coluna 2: Feed de Mensagens (8 colunas) */}
        <SurfaceCard className="p-3.5 flex flex-col min-h-0 md:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100 dark:border-zinc-800">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-xs font-bold text-slate-900 dark:text-white uppercase truncate">
                {filtroGrupo}
              </span>
              <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400">
                {mensagensFiltradas.length} msgs
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={copiarFeed}
                disabled={mensagensFiltradas.length === 0}
                className="flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-xs font-mono text-slate-700 dark:text-zinc-300 disabled:opacity-40 cursor-pointer"
                title="Copiar mensagens filtradas"
              >
                <Copy className="w-3 h-3" />
                <span>{copiadoFeed ? "COPIADO!" : "COPIAR"}</span>
              </button>

              <button
                onClick={limpar}
                disabled={mensagens.length === 0}
                className="flex items-center gap-1 px-2.5 py-1 rounded border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-mono cursor-pointer disabled:opacity-30"
                title="Limpar histórico (Ctrl+L)"
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
                  placeholder="Filtrar feed... (Ctrl+F)"
                  className="w-44 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 pl-7 pr-2 py-1 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Área do Feed com Auto-Scroll Inteligente */}
          <div className="relative flex-1 min-h-0 mt-2">
            <div
              ref={feedRef}
              onScroll={handleFeedScroll}
              className="absolute inset-0 overflow-y-auto rounded border border-slate-200 dark:border-zinc-800 bg-slate-900 dark:bg-[#070709] p-3 font-mono text-xs space-y-2 select-text leading-relaxed"
            >
              {mensagensFiltradas.length === 0 ? (
                <div className="text-slate-500 dark:text-zinc-600 text-center py-20 font-mono text-xs">
                  {status.rodando
                    ? "AGUARDANDO MENSAGENS DO WEBHOOK..."
                    : "RECEPTOR DESLIGADO. CLIQUE EM 'INICIAR RECEPTOR' ACIMA."}
                </div>
              ) : (
                mensagensFiltradas.map((m) => {
                  const contemPedido = /#\d+|pedido\s*\d+/i.test(m.texto);
                  return (
                    <div
                      key={m.id}
                      className={`group rounded p-1.5 transition-colors flex items-start justify-between gap-2 ${
                        contemPedido
                          ? "bg-amber-950/20 border-l-2 border-l-amber-500"
                          : "hover:bg-slate-800/40"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <span className="text-slate-400 dark:text-zinc-500">[{m.hora}] </span>
                        {filtroGrupo === TODOS && (
                          <span className="text-sky-400 font-semibold">[{m.grupo}] </span>
                        )}
                        {m.tipo_midia === "imagem" && (
                          <span className="inline-flex items-center gap-0.5 text-purple-400 text-[10px] font-bold px-1 rounded bg-purple-950/60 mr-1">
                            <Image className="w-2.5 h-2.5" /> FOTO
                          </span>
                        )}
                        {m.tipo_midia === "documento" && (
                          <span className="inline-flex items-center gap-0.5 text-blue-400 text-[10px] font-bold px-1 rounded bg-blue-950/60 mr-1">
                            <FileSpreadsheet className="w-2.5 h-2.5" /> DOC
                          </span>
                        )}
                        {m.tipo_midia === "audio" && (
                          <span className="inline-flex items-center gap-0.5 text-emerald-400 text-[10px] font-bold px-1 rounded bg-emerald-950/60 mr-1">
                            <Mic className="w-2.5 h-2.5" /> ÁUDIO
                          </span>
                        )}

                        <span className="text-emerald-400 font-bold">{m.autor}: </span>
                        <span className={contemPedido ? "text-amber-200 font-medium" : "text-slate-200"}>
                          {m.texto}
                        </span>
                      </div>

                      <button
                        onClick={() => copiarMensagem(m.texto)}
                        className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-white cursor-pointer p-0.5 transition-opacity shrink-0"
                        title="Copiar texto da mensagem"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Botão Flutuante de Rolar para o Fim */}
            {!autoScroll && mensagensFiltradas.length > 0 && (
              <button
                onClick={rolarParaFim}
                className="absolute bottom-3 right-5 flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-mono text-xs font-bold shadow-lg cursor-pointer transition-all"
              >
                <ArrowDown className="w-3.5 h-3.5 animate-bounce" />
                <span>Novas mensagens</span>
              </button>
            )}
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}
