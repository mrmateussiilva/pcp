import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  BarChart3,
  FileText,
  Flame,
  FolderTree,
  HardDrive,
  Info,
  LayoutGrid,
  MessageSquare,
  Moon,
  PackageCheck,
  Printer,
  Scissors,
  ShoppingBag,
  Sun,
  Terminal,
} from "lucide-react";
import "./App.css";
import { MODULOS, ModuloId } from "./modules/registry";
import { HomePage } from "./pages/HomePage";
import { PastasDiaPage } from "./pages/PastasDiaPage";
import { TiffProcessorPage } from "./pages/TiffProcessorPage";
import { BolsinhasPage } from "./pages/BolsinhasPage";
import { CortadorPage } from "./pages/CortadorPage";
import { ConsumoPage } from "./pages/ConsumoPage";
import { ShopeePage } from "./pages/ShopeePage";
import { CalandragemPage } from "./pages/CalandragemPage";
import { NotepadPage } from "./pages/NotepadPage";
import { WhatsappPage } from "./pages/WhatsappPage";
import { AboutPage } from "./pages/AboutPage";

const GRUPOS = ["DIA A DIA", "PRODUÇÃO", "COMUNICAÇÃO"] as const;

export function ModuleIcon({ id, className = "w-4 h-4" }: { id: ModuloId; className?: string }) {
  switch (id) {
    case "inicio":
      return <LayoutGrid className={className} />;
    case "pastas":
      return <FolderTree className={className} />;
    case "tiff":
      return <Printer className={className} />;
    case "bolsinhas":
      return <ShoppingBag className={className} />;
    case "cortador":
      return <Scissors className={className} />;
    case "consumo":
      return <BarChart3 className={className} />;
    case "shopee":
      return <PackageCheck className={className} />;
    case "calandragem":
      return <Flame className={className} />;
    case "notepad":
      return <FileText className={className} />;
    case "whatsapp":
      return <MessageSquare className={className} />;
  }
}

export type StatusInfo = { text: string; cor: "green" | "amber" };

export default function App() {
  const [atual, setAtual] = useState<ModuloId | "about">("inicio");
  const [dark, setDark] = useState<boolean>(() => {
    return localStorage.getItem("pcp-theme") === "dark";
  });
  const [statusMap, setStatusMap] = useState<Partial<Record<ModuloId, StatusInfo>>>({});
  const [driveBase, setDriveBase] = useState<string>("Z:\\");

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add("dark");
      localStorage.setItem("pcp-theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("pcp-theme", "light");
    }
  }, [dark]);

  useEffect(() => {
    invoke<{ base: string }>("get_config").then((cfg) => {
      if (cfg?.base) setDriveBase(cfg.base);
    });

    invoke<{ rodando: boolean }>("notepad_status").then((st) => {
      setStatusMap((prev) => ({
        ...prev,
        notepad: st.rodando ? { text: "HTTP/WS :8766", cor: "green" } : undefined,
      }));
    });
    invoke<{ rodando: boolean; porta: number }>("whatsapp_status").then((st) => {
      setStatusMap((prev) => ({
        ...prev,
        whatsapp: st.rodando
          ? { text: `HOOK :${st.porta}`, cor: "green" }
          : undefined,
      }));
    });
    invoke<{ monitorando: boolean }>("tiff_status").then((st) => {
      setStatusMap((prev) => ({
        ...prev,
        tiff: st.monitorando ? { text: "WATCHER ATIVO", cor: "green" } : undefined,
      }));
    });
    invoke<{ monitorando: boolean; varrendo: boolean }>("bolsinhas_status").then((st) => {
      setStatusMap((prev) => ({
        ...prev,
        bolsinhas: st.varrendo
          ? { text: "VARRENDO...", cor: "amber" }
          : st.monitorando
          ? { text: "WATCHER ATIVO", cor: "green" }
          : undefined,
      }));
    });
    invoke<{ rodando: boolean; porta: number }>("calandragem_status").then((st) => {
      setStatusMap((prev) => ({
        ...prev,
        calandragem: st.rodando ? { text: `SRV :${st.porta}`, cor: "green" } : undefined,
      }));
    });
    invoke<{ monitorando: boolean }>("consumo_status").then((st) => {
      setStatusMap((prev) => ({
        ...prev,
        consumo: st.monitorando ? { text: "OBSERVANDO", cor: "green" } : undefined,
      }));
    });

    const unNote = listen<{ rodando: boolean }>("notepad-estado", (e) => {
      setStatusMap((prev) => ({
        ...prev,
        notepad: e.payload.rodando
          ? { text: "HTTP/WS :8766", cor: "green" }
          : undefined,
      }));
    });
    const unZap = listen<{ rodando: boolean; porta: number }>("whatsapp-status", (e) => {
      setStatusMap((prev) => ({
        ...prev,
        whatsapp: e.payload.rodando
          ? { text: `HOOK :${e.payload.porta}`, cor: "green" }
          : undefined,
      }));
    });
    const unTiff = listen<{ monitorando: boolean }>("tiff-status", (e) => {
      setStatusMap((prev) => ({
        ...prev,
        tiff: e.payload.monitorando
          ? { text: "WATCHER ATIVO", cor: "green" }
          : undefined,
      }));
    });
    const unBol = listen<{ monitorando: boolean; varrendo: boolean }>(
      "bolsinhas-status",
      (e) => {
        setStatusMap((prev) => ({
          ...prev,
          bolsinhas: e.payload.varrendo
            ? { text: "VARRENDO...", cor: "amber" }
            : e.payload.monitorando
            ? { text: "WATCHER ATIVO", cor: "green" }
            : undefined,
        }));
      }
    );
    const unCort = listen<boolean>("cortador-status", (e) => {
      setStatusMap((prev) => ({
        ...prev,
        cortador: e.payload ? { text: "CORTANDO...", cor: "amber" } : undefined,
      }));
    });
    const unShopee = listen<{ monitorando: boolean; executando: boolean }>(
      "shopee-status",
      (e) => {
        setStatusMap((prev) => ({
          ...prev,
          shopee: e.payload.executando
            ? { text: "RENDERIZANDO...", cor: "amber" }
            : e.payload.monitorando
            ? { text: "WATCHER ATIVO", cor: "green" }
            : undefined,
        }));
      }
    );

    const unCal = listen<{ rodando: boolean; porta: number }>(
      "calandragem-status",
      (e) => {
        setStatusMap((prev) => ({
          ...prev,
          calandragem: e.payload.rodando
            ? { text: `SRV :${e.payload.porta}`, cor: "green" }
            : undefined,
        }));
      }
    );
    const unConsumo = listen<{ monitorando: boolean }>(
      "consumo-status",
      (e) => {
        setStatusMap((prev) => ({
          ...prev,
          consumo: e.payload.monitorando
            ? { text: "OBSERVANDO", cor: "green" }
            : undefined,
        }));
      }
    );

    return () => {
      unNote.then((fn) => fn());
      unZap.then((fn) => fn());
      unTiff.then((fn) => fn());
      unBol.then((fn) => fn());
      unCort.then((fn) => fn());
      unShopee.then((fn) => fn());
      unCal.then((fn) => fn());
      unConsumo.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key === "0") {
        e.preventDefault();
        setAtual("inicio");
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && MODULOS[n - 1]) {
        e.preventDefault();
        setAtual(MODULOS[n - 1].id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const totalAtivos = Object.values(statusMap).filter(Boolean).length;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#f4f5f8] dark:bg-[#09090b] text-slate-800 dark:text-zinc-200 antialiased select-none font-sans flex-col">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar Técnica Industrial */}
        <aside className="w-[224px] shrink-0 bg-white dark:bg-[#0e0e11] border-r border-slate-200 dark:border-zinc-800 flex flex-col justify-between">
          <div className="flex flex-col min-h-0">
            {/* Header da Barra Lateral */}
            <div className="px-3.5 py-3 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded border border-slate-400 dark:border-zinc-700 bg-slate-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-slate-900">
                  <Terminal className="w-3 h-3" />
                </div>
                <div>
                  <div className="text-xs font-bold tracking-tight text-slate-900 dark:text-zinc-100 leading-none">
                    PCP CENTRAL
                  </div>
                  <div className="text-[9px] font-mono text-slate-500 dark:text-zinc-500 tracking-wider">
                    SUBLIMAÇÃO // RIP
                  </div>
                </div>
              </div>
              <span className="text-[9px] font-mono font-semibold px-1 py-0.5 rounded border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400">
                v2.0
              </span>
            </div>

            {/* Navegação */}
            <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
              <button
                onClick={() => setAtual("inicio")}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs font-medium cursor-pointer transition-colors ${
                  atual === "inicio"
                    ? "bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900 shadow-2xs font-semibold"
                    : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800/60"
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <ModuleIcon
                    id="inicio"
                    className={`w-3.5 h-3.5 ${
                      atual === "inicio"
                        ? "text-white dark:text-slate-900"
                        : "text-slate-400 dark:text-zinc-500"
                    }`}
                  />
                  <span>Centro de Comando</span>
                </span>
                <kbd className={`text-[9px] font-mono px-1 rounded ${
                  atual === "inicio" ? "bg-slate-800 dark:bg-zinc-200 text-slate-300 dark:text-zinc-700" : "text-slate-400 dark:text-zinc-600"
                }`}>^0</kbd>
              </button>

              {GRUPOS.map((grupo) => {
                const itens = MODULOS.filter((m) => m.grupo === grupo);
                return (
                  <div key={grupo} className="pt-3">
                    <div className="px-2.5 pb-1 text-[9px] font-mono font-semibold tracking-wider text-slate-400 dark:text-zinc-500 uppercase">
                      {grupo}
                    </div>
                    <div className="space-y-0.5">
                      {itens.map((m) => {
                        const st = statusMap[m.id];
                        const idx = MODULOS.findIndex((x) => x.id === m.id) + 1;
                        const active = atual === m.id;
                        return (
                          <button
                            key={m.id}
                            onClick={() => setAtual(m.id)}
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs cursor-pointer transition-colors ${
                              active
                                ? "bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900 font-semibold shadow-2xs"
                                : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800/60 font-medium"
                            }`}
                          >
                            <span className="flex items-center gap-2 truncate">
                              <ModuleIcon
                                id={m.id}
                                className={`w-3.5 h-3.5 shrink-0 ${
                                  active
                                    ? "text-white dark:text-slate-900"
                                    : "text-slate-400 dark:text-zinc-500"
                                }`}
                              />
                              <span className="truncate">{m.nome}</span>
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0 ml-1">
                              {st && (
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    st.cor === "amber" ? "bg-amber-500" : "bg-emerald-500"
                                  } animate-pulse`}
                                  title={st.text}
                                />
                              )}
                              <kbd className={`text-[9px] font-mono px-0.5 rounded ${
                                active ? "bg-slate-800 dark:bg-zinc-200 text-slate-300 dark:text-zinc-700" : "text-slate-400 dark:text-zinc-600"
                              }`}>
                                ^{idx}
                              </kbd>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </nav>
          </div>

          {/* Rodapé da Sidebar */}
          <div className="p-2 border-t border-slate-200 dark:border-zinc-800 flex items-center justify-between text-xs">
            <button
              onClick={() => setDark((d) => !d)}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
              title="Alternar Modo Claro / Escuro"
            >
              {dark ? <Sun className="w-3.5 h-3.5 text-amber-500" /> : <Moon className="w-3.5 h-3.5 text-slate-500" />}
              <span>{dark ? "Claro" : "Escuro"}</span>
            </button>

            <button
              onClick={() => setAtual("about")}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium cursor-pointer transition-colors ${
                atual === "about"
                  ? "bg-slate-200 dark:bg-zinc-800 text-slate-900 dark:text-white"
                  : "text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
              }`}
            >
              <Info className="w-3.5 h-3.5" />
              <span>Specs</span>
            </button>
          </div>
        </aside>

        {/* Área de Trabalho Central */}
        <main className="flex-1 overflow-y-auto bg-[#f8f9fa] dark:bg-[#09090b]">
          {atual === "inicio" && <HomePage onAbrir={setAtual} statusMap={statusMap} driveBase={driveBase} />}
          {atual === "pastas" && <PastasDiaPage />}
          {atual === "tiff" && <TiffProcessorPage />}
          {atual === "bolsinhas" && <BolsinhasPage />}
          {atual === "cortador" && <CortadorPage />}
          {atual === "consumo" && <ConsumoPage />}
          {atual === "shopee" && <ShopeePage />}
          {atual === "calandragem" && <CalandragemPage />}
          {atual === "notepad" && <NotepadPage />}
          {atual === "whatsapp" && <WhatsappPage />}
          {atual === "about" && <AboutPage />}
        </main>
      </div>

      {/* Barra de Telemetria Inferior (Industrial Status Bar) */}
      <footer className="h-6.5 shrink-0 bg-white dark:bg-[#0c0c0e] border-t border-slate-200 dark:border-zinc-800/80 px-3 flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-zinc-400 z-10">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <HardDrive className="w-3 h-3 text-slate-400 dark:text-zinc-500" />
            <span className="text-slate-700 dark:text-zinc-300 font-semibold">{driveBase}</span>
          </span>
          <span className="text-slate-300 dark:text-zinc-700">|</span>
          <span className="flex items-center gap-1">
            <span className="text-slate-400 dark:text-zinc-500">SERVIÇOS ATIVOS:</span>
            <span className={`font-semibold ${totalAtivos > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500"}`}>
              {totalAtivos}
            </span>
          </span>
          {statusMap.notepad && (
            <>
              <span className="text-slate-300 dark:text-zinc-700">•</span>
              <span className="text-emerald-600 dark:text-emerald-400">NOTEPAD :8766</span>
            </>
          )}
          {statusMap.calandragem && (
            <>
              <span className="text-slate-300 dark:text-zinc-700">•</span>
              <span className="text-emerald-600 dark:text-emerald-400">CALANDRAGEM :8767</span>
            </>
          )}
          {statusMap.whatsapp && (
            <>
              <span className="text-slate-300 dark:text-zinc-700">•</span>
              <span className="text-emerald-600 dark:text-emerald-400">ZAP :5050</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span>ATALHOS: [Ctrl+0..9]</span>
          <span className="text-slate-300 dark:text-zinc-700">|</span>
          <span className="text-slate-600 dark:text-zinc-400">PCP_KERNEL_RUST_OK</span>
        </div>
      </footer>
    </div>
  );
}
