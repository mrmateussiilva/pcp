import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import QRCode from "qrcode";
import {
  Clock,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  History,
  Play,
  QrCode,
  RotateCcw,
  Square,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  PageHeader,
  StatCard,
  StatusBadge,
  SurfaceCard,
} from "../components/ui";
import { usePageShortcuts } from "../hooks/useShortcuts";

interface NotepadConfig {
  arquivo: string;
  auto_iniciar: boolean;
  ws_port: number;
  http_port: number;
}

interface NotepadStatus {
  rodando: boolean;
  http_ativo: boolean;
  ws_port: number;
  http_port: number;
  link: string;
  ip_local: string;
  text: string;
  author: string | null;
  updated_at: string | null;
  clients: number;
  total_revisoes: number;
}

interface NotepadHistoricoItem {
  id: number;
  text: string;
  author: string;
  updated_at: string;
  tamanho: number;
}

export function NotepadPage() {
  const [arquivo, setArquivo] = useState("");
  const [wsPort, setWsPort] = useState("8765");
  const [httpPort, setHttpPort] = useState("8766");
  const [autoIniciar, setAutoIniciar] = useState(true);
  const [status, setStatus] = useState<NotepadStatus>({
    rodando: false,
    http_ativo: false,
    ws_port: 8765,
    http_port: 8766,
    link: "",
    ip_local: "127.0.0.1",
    text: "",
    author: null,
    updated_at: null,
    clients: 0,
    total_revisoes: 0,
  });
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [copiadoTexto, setCopiadoTexto] = useState(false);

  // Tabs: 'editor' | 'historico'
  const [abaAtiva, setAbaAtiva] = useState<"editor" | "historico">("editor");
  const [historico, setHistorico] = useState<NotepadHistoricoItem[]>([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);

  // Modal QR Code
  const [mostrarQr, setMostrarQr] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const debounceRef = useRef<number | null>(null);
  const ultimoTextoRemotoRef = useRef("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const carregarHistorico = useCallback(async () => {
    setCarregandoHistorico(true);
    try {
      const items = await invoke<NotepadHistoricoItem[]>("notepad_obter_historico");
      setHistorico(items.reverse()); // Mais recentes primeiro
    } catch (_) {
      // silencioso
    } finally {
      setCarregandoHistorico(false);
    }
  }, []);

  const aplicarEstado = useCallback((st: NotepadStatus) => {
    setStatus(st);
    if (st.rodando && st.text !== ultimoTextoRemotoRef.current) {
      ultimoTextoRemotoRef.current = st.text;
      setTexto(st.text);
    }
  }, []);

  useEffect(() => {
    invoke<NotepadConfig>("notepad_get_config").then((cfg) => {
      setArquivo(cfg.arquivo);
      setAutoIniciar(cfg.auto_iniciar);
      setWsPort(String(cfg.ws_port || 8765));
      setHttpPort(String(cfg.http_port || 8766));
    });

    invoke<NotepadStatus>("notepad_status").then(aplicarEstado);

    const unlisten = listen<NotepadStatus>("notepad-estado", (e) => {
      aplicarEstado(e.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [aplicarEstado]);

  // Gera QR Code quando o link estiver ativo
  useEffect(() => {
    if (status.link) {
      QRCode.toDataURL(status.link, {
        width: 240,
        margin: 1.5,
        color: {
          dark: "#09090b",
          light: "#ffffff",
        },
      })
        .then((url) => setQrDataUrl(url))
        .catch(() => setQrDataUrl(null));
    }
  }, [status.link]);

  // Recarrega histórico quando entrar na aba
  useEffect(() => {
    if (abaAtiva === "historico") {
      carregarHistorico();
    }
  }, [abaAtiva, carregarHistorico]);

  const selecionarArquivo = async () => {
    const file = await open({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof file === "string") setArquivo(file);
  };

  const salvarConfig = async (novoAuto = autoIniciar) => {
    await invoke("notepad_save_config", {
      payload: {
        arquivo,
        auto_iniciar: novoAuto,
        ws_port: Number(wsPort) || 8765,
        http_port: Number(httpPort) || 8766,
      },
    });
  };

  const alternarServidor = async () => {
    setErro(null);
    try {
      if (status.rodando) {
        const st = await invoke<NotepadStatus>("notepad_parar");
        setStatus(st);
      } else {
        const ws = Number(wsPort) || 8765;
        const http = Number(httpPort) || 8766;
        const st = await invoke<NotepadStatus>("notepad_iniciar", {
          arquivo,
          autoIniciar,
          wsPort: ws,
          httpPort: http,
        });
        aplicarEstado(st);
      }
    } catch (e) {
      setErro(String(e));
    }
  };

  const onDigitar = (novoTexto: string) => {
    setTexto(novoTexto);
    ultimoTextoRemotoRef.current = novoTexto;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      invoke("notepad_set_texto", { text: novoTexto });
    }, 150);
  };

  const inserirTimestamp = () => {
    const now = new Date();
    const timeStr = `[${now.toLocaleTimeString("pt-BR")}] `;
    const textarea = textareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const novo = texto.substring(0, start) + timeStr + texto.substring(end);
      onDigitar(novo);
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + timeStr.length;
        textarea.focus();
      }, 10);
    } else {
      onDigitar(texto + (texto ? "\n" : "") + timeStr);
    }
  };

  const limparParaTodos = () => {
    if (
      texto.length > 0 &&
      !window.confirm(
        "Limpar o bloco para todos os operadores conectados? Uma cópia de backup será mantida no histórico."
      )
    ) {
      return;
    }
    onDigitar("");
    invoke("notepad_set_texto", { text: "" });
  };

  const copiarLink = async () => {
    if (!status.link) return;
    await navigator.clipboard.writeText(status.link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  };

  const copiarTodoTexto = async () => {
    if (!texto) return;
    await navigator.clipboard.writeText(texto);
    setCopiadoTexto(true);
    setTimeout(() => setCopiadoTexto(false), 1500);
  };

  const abrirNoNavegador = () => {
    if (status.link) {
      openUrl(status.link);
    }
  };

  const restaurarVersao = async (id: number) => {
    if (
      !window.confirm(
        "Restaurar esta versão anterior? O texto atual será substituído para todos os dispositivos conectados."
      )
    ) {
      return;
    }
    try {
      await invoke("notepad_restaurar_versao", { versaoId: id });
      setAbaAtiva("editor");
    } catch (e) {
      setErro(String(e));
    }
  };

  const limparHistoricoRevisoes = async () => {
    if (!window.confirm("Limpar todo o histórico de backups e versões?")) return;
    await invoke("notepad_limpar_historico");
    setHistorico([]);
  };

  usePageShortcuts([
    {
      id: "note-toggle",
      combo: "ctrl+enter",
      keys: "Ctrl+Enter",
      label: status.rodando ? "Parar Servidor Notepad" : "Iniciar Servidor Notepad",
      action: alternarServidor,
    },
    { id: "note-file", combo: "ctrl+o", keys: "Ctrl+O", label: "Selecionar Arquivo JSON", action: selecionarArquivo },
    { id: "note-copy", combo: "ctrl+shift+c", keys: "Ctrl+Shift+C", label: "Copiar Link da Rede", action: copiarLink },
    { id: "note-time", combo: "alt+t", keys: "Alt+T", label: "Inserir Timestamp", action: inserirTimestamp },
    { id: "note-qr", combo: "alt+q", keys: "Alt+Q", label: "Alternar QR Code", action: () => setMostrarQr((prev) => !prev) },
    { id: "note-tab-editor", combo: "alt+1", keys: "Alt+1", label: "Aba Editor", action: () => setAbaAtiva("editor") },
    { id: "note-tab-hist", combo: "alt+2", keys: "Alt+2", label: "Aba Histórico", action: () => setAbaAtiva("historico") },
  ]);

  const formatarHora = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString("pt-BR");
  };

  const linhasTexto = texto ? texto.split("\n").length : 0;

  return (
    <div className="p-5 h-full flex flex-col gap-3.5 max-w-7xl mx-auto overflow-y-auto">
      {/* Cabeçalho */}
      <PageHeader
        icon={<FileText className="w-4 h-4 text-slate-700 dark:text-zinc-300" />}
        title="Notepad Colaborativo // Axum Sockets"
        badge="SRV-02"
        subtitle="Servidor local WebSocket + HTTP servindo editor em tempo real com QR code mobile e backups atômicos."
        right={
          <StatusBadge
            active={status.rodando}
            activeText={`ONLINE :${status.http_port || 8766}`}
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
          label="Status do Serviço"
          value={status.rodando ? "ONLINE" : "STANDBY"}
          unit={status.rodando ? `HTTP :${status.http_port}` : "desligado"}
          tone={status.rodando ? "emerald" : "zinc"}
        />

        <StatCard
          label="Nós Conectados"
          value={status.rodando ? status.clients : 0}
          unit="dispositivos LAN"
          tone="sky"
        />

        <StatCard
          label="Tamanho do Buffer"
          value={texto.length}
          unit={`${linhasTexto} lin`}
          tone="zinc"
        />

        <StatCard
          label="Revisões / Backups"
          value={status.total_revisoes}
          unit="versões gravadas"
          tone={status.total_revisoes > 0 ? "blue" : "zinc"}
        />
      </div>

      {/* Toolbar do Servidor e Conectividade */}
      <SurfaceCard className="p-3.5 space-y-3">
        {/* Linha do Arquivo de Estado */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-slate-500 dark:text-zinc-400 w-28 shrink-0">
            STATE FILE:
          </span>
          <input
            type="text"
            value={arquivo}
            disabled={status.rodando}
            onChange={(e) => setArquivo(e.target.value)}
            className="flex-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white disabled:opacity-50 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={selecionarArquivo}
            disabled={status.rodando}
            title="Selecionar arquivo JSON (Ctrl+O)"
            className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-40 text-slate-700 dark:text-zinc-300 cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Linha de Portas, Controle e Link */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-zinc-800 font-mono text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">HTTP:</span>
              <input
                type="text"
                value={httpPort}
                disabled={status.rodando}
                onChange={(e) => setHttpPort(e.target.value)}
                className="w-16 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2 py-1 text-xs text-slate-900 dark:text-white disabled:opacity-50 text-center font-bold"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">WS:</span>
              <input
                type="text"
                value={wsPort}
                disabled={status.rodando}
                onChange={(e) => setWsPort(e.target.value)}
                className="w-16 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2 py-1 text-xs text-slate-900 dark:text-white disabled:opacity-50 text-center font-bold"
              />
            </div>

            <button
              onClick={alternarServidor}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded text-xs font-bold text-white cursor-pointer transition-all shadow-2xs uppercase ${
                status.rodando
                  ? "bg-red-600 hover:bg-red-500 border border-red-700"
                  : "bg-emerald-600 hover:bg-emerald-500 border border-emerald-700"
              }`}
            >
              {status.rodando ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{status.rodando ? "DESLIGAR (Ctrl+Enter)" : "INICIAR SERVIÇO (Ctrl+Enter)"}</span>
            </button>

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
          </div>

          {/* Links e Acesso Móvel */}
          {status.rodando && status.link && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded px-2.5 py-1">
                <span className="text-blue-700 dark:text-blue-400 font-bold select-text">
                  {status.link}
                </span>
                <button
                  onClick={copiarLink}
                  className="text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer p-0.5"
                  title="Copiar URL para a área de transferência (Ctrl+Shift+C)"
                >
                  {copiado ? <span className="text-[10px] text-emerald-600 font-bold">COPIADO!</span> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={abrirNoNavegador}
                  className="text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer p-0.5"
                  title="Abrir no navegador padrão"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                onClick={() => setMostrarQr(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-mono text-xs font-semibold cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/60"
                title="Exibir QR Code para leitura em celular/tablet (Alt+Q)"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>QR CODE</span>
              </button>
            </div>
          )}
        </div>
      </SurfaceCard>

      {/* Abas e Barra de Metadados */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAbaAtiva("editor")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded font-mono text-xs cursor-pointer font-bold ${
              abaAtiva === "editor"
                ? "bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900"
                : "text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>EDITOR (Alt+1)</span>
          </button>
          <button
            onClick={() => setAbaAtiva("historico")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded font-mono text-xs cursor-pointer font-bold ${
              abaAtiva === "historico"
                ? "bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900"
                : "text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>HISTÓRICO & BACKUPS (Alt+2)</span>
            {status.total_revisoes > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-500 text-white">
                {status.total_revisoes}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-4 font-mono text-[11px] text-slate-500 dark:text-zinc-400">
          <span>
            ÚLTIMA MODIFICAÇÃO:{" "}
            <span className="text-slate-800 dark:text-zinc-200 font-semibold">
              {status.author ? `${status.author} às ${formatarHora(status.updated_at)}` : "—"}
            </span>
          </span>
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
            <Users className="w-3 h-3" />
            <span>{status.rodando ? `${status.clients} NÓS` : "OFFLINE"}</span>
          </span>
        </div>
      </div>

      {/* Conteúdo Principal */}
      {abaAtiva === "editor" ? (
        <div className="flex-1 flex flex-col min-h-[380px] gap-2">
          {/* Barra de Ações Rápidas do Editor */}
          <div className="flex items-center justify-between font-mono text-xs">
            <div className="flex items-center gap-2">
              <button
                onClick={inserirTimestamp}
                disabled={!status.rodando}
                className="flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300 disabled:opacity-40 cursor-pointer shadow-2xs"
                title="Inserir data e hora atual no cursor (Alt+T)"
              >
                <Clock className="w-3.5 h-3.5 text-blue-500" />
                <span>Timestamp (Alt+T)</span>
              </button>
              <button
                onClick={copiarTodoTexto}
                disabled={!texto}
                className="flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300 disabled:opacity-40 cursor-pointer shadow-2xs"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiadoTexto ? "Copiado!" : "Copiar Texto"}</span>
              </button>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-slate-400 dark:text-zinc-500 text-[11px] tabular-nums">
                {texto.length} carac • {linhasTexto} lin
              </span>
              <button
                onClick={limparParaTodos}
                disabled={!status.rodando || texto.length === 0}
                className="flex items-center gap-1 px-2.5 py-1 rounded border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-30 cursor-pointer font-semibold shadow-2xs transition-colors"
                title="Limpar bloco de notas (grava snapshot no histórico antes de limpar)"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Limpar Buffer</span>
              </button>
            </div>
          </div>

          {/* Área de Texto Monospace */}
          <textarea
            ref={textareaRef}
            value={texto}
            disabled={!status.rodando}
            onChange={(e) => onDigitar(e.target.value)}
            placeholder={
              status.rodando
                ? "Digite aqui... Todos os terminais conectados na rede sincronizam em tempo real."
                : "Ligue o serviço acima para iniciar o editor compartilhado..."
            }
            className="flex-1 w-full resize-none rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4 font-mono text-sm text-slate-900 dark:text-zinc-100 leading-relaxed focus:outline-none focus:border-blue-500 disabled:opacity-40 select-text shadow-2xs min-h-[300px]"
          />
        </div>
      ) : (
        /* Aba de Histórico de Revisões */
        <SurfaceCard className="p-4 flex-1 flex flex-col min-h-[380px]">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 dark:border-zinc-800">
            <div>
              <div className="font-mono text-xs font-bold text-slate-900 dark:text-white uppercase">
                HISTÓRICO DE BACKUPS E VERSÕES ANTERIORES
              </div>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                Cada edição significativa ou limpeza gera um snapshot seguro que pode ser restaurado a qualquer momento.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={carregarHistorico}
                disabled={carregandoHistorico}
                className="px-2.5 py-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 text-xs font-mono cursor-pointer hover:bg-slate-200 dark:hover:bg-zinc-700"
              >
                Atualizar
              </button>
              {historico.length > 0 && (
                <button
                  onClick={limparHistoricoRevisoes}
                  className="px-2.5 py-1 rounded border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 text-xs font-mono cursor-pointer hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  Limpar Histórico
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {historico.length === 0 ? (
              <div className="text-center py-16 text-slate-400 dark:text-zinc-500 font-mono text-xs">
                Nenhuma revisão gravada ainda. O histórico é preenchido conforme o bloco é editado.
              </div>
            ) : (
              historico.map((rev) => (
                <div
                  key={rev.id}
                  className="rounded border border-slate-200 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/40 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-300 dark:hover:border-zinc-700 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-800 dark:text-zinc-200">
                        {rev.author}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400 dark:text-zinc-500">
                        {formatarHora(rev.updated_at)}
                      </span>
                      <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400">
                        {rev.tamanho} carac
                      </span>
                    </div>

                    <div className="mt-1 font-mono text-xs text-slate-600 dark:text-zinc-400 line-clamp-2 select-text bg-white dark:bg-zinc-950 p-2 rounded border border-slate-200/60 dark:border-zinc-800/60">
                      {rev.text || <em className="text-slate-400">Texto vazio</em>}
                    </div>
                  </div>

                  <button
                    onClick={() => restaurarVersao(rev.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-blue-600 bg-blue-600 hover:bg-blue-500 text-white font-mono text-xs font-bold cursor-pointer shrink-0 uppercase shadow-2xs"
                    title="Restaurar esta versão para o editor e rede"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restaurar</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </SurfaceCard>
      )}

      {/* Modal QR Code */}
      {mostrarQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="rounded-lg bg-white dark:bg-[#111115] border border-slate-300 dark:border-zinc-700 shadow-xl max-w-sm w-full p-5 flex flex-col items-center gap-3">
            <div className="flex items-center justify-between w-full pb-2 border-b border-slate-100 dark:border-zinc-800">
              <span className="font-mono text-xs font-bold uppercase text-slate-900 dark:text-white">
                ACESSO MÓVEL // QR CODE
              </span>
              <button
                onClick={() => setMostrarQr(false)}
                className="p-1 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded cursor-pointer text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-zinc-400 text-center font-sans">
              Aponte a câmera do celular ou tablet conectado no mesmo Wi-Fi para abrir o Bloco de Notas:
            </p>

            {qrDataUrl ? (
              <div className="p-3 bg-white rounded-md border border-slate-200 shadow-inner">
                <img src={qrDataUrl} alt="QR Code Notepad" className="w-52 h-52" />
              </div>
            ) : (
              <div className="w-52 h-52 flex items-center justify-center font-mono text-xs text-slate-400">
                Gerando QR...
              </div>
            )}

            <div className="text-center font-mono text-xs text-blue-600 dark:text-blue-400 font-bold select-all bg-slate-50 dark:bg-zinc-900 px-3 py-1.5 rounded border border-slate-200 dark:border-zinc-800 w-full break-all">
              {status.link}
            </div>

            <button
              onClick={() => setMostrarQr(false)}
              className="w-full py-2 rounded bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900 font-mono text-xs font-bold cursor-pointer uppercase mt-1"
            >
              FECHAR
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
