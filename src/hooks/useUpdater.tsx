import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

/** Primeira verificação após abrir o app e intervalo das verificações periódicas. */
const PRIMEIRA_VERIFICACAO_MS = 8_000;
const INTERVALO_VERIFICACAO_MS = 30 * 60_000;
const LS_NOTIFICADA = "pcp-update-notificada";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "uptodate"
  | "available"
  | "downloading"
  | "installing"
  | "error";

export interface UpdateInfo {
  version: string;
  date?: string;
  notes?: string;
}

interface UpdaterContextValue {
  phase: UpdatePhase;
  currentVersion: string;
  update: UpdateInfo | null;
  /** bytes baixados / total (total pode ser 0 se o servidor não informar) */
  progress: { downloaded: number; total: number };
  error: string | null;
  lastCheck: Date | null;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  checkNow: (manual?: boolean) => Promise<void>;
  install: () => Promise<void>;
}

const UpdaterContext = createContext<UpdaterContextValue | null>(null);

async function notificarNovaVersao(version: string) {
  if (localStorage.getItem(LS_NOTIFICADA) === version) return;
  try {
    let ok = await isPermissionGranted();
    if (!ok) ok = (await requestPermission()) === "granted";
    if (ok) {
      sendNotification({
        title: "PCP Central — nova versão disponível",
        body: `Versão ${version} pronta para instalar. Clique em "UPD" na barra inferior.`,
      });
    }
    localStorage.setItem(LS_NOTIFICADA, version);
  } catch {
    /* notificação é opcional */
  }
}

export function UpdaterProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [currentVersion, setCurrentVersion] = useState("—");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState({ downloaded: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const updateRef = useRef<Update | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => {});
  }, []);

  const checkNow = useCallback(async (manual = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase("checking");
    setError(null);
    try {
      const upd = await check({ timeout: 20_000 });
      setLastCheck(new Date());
      if (upd) {
        updateRef.current = upd;
        setUpdate({ version: upd.version, date: upd.date, notes: upd.body });
        setPhase("available");
        if (!manual) notificarNovaVersao(upd.version);
      } else {
        updateRef.current = null;
        setUpdate(null);
        setPhase("uptodate");
      }
    } catch (e) {
      setLastCheck(new Date());
      setError(String(e));
      // Falha silenciosa nas verificações automáticas (ex.: PC sem internet):
      // só mostra erro quando o operador pediu explicitamente.
      setPhase(manual ? "error" : updateRef.current ? "available" : "idle");
    } finally {
      busyRef.current = false;
    }
  }, []);

  const install = useCallback(async () => {
    const upd = updateRef.current;
    if (!upd || busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setPhase("downloading");
    setProgress({ downloaded: 0, total: 0 });
    try {
      await upd.downloadAndInstall((ev) => {
        if (ev.event === "Started") {
          setProgress({ downloaded: 0, total: ev.data.contentLength ?? 0 });
        } else if (ev.event === "Progress") {
          setProgress((p) => ({ ...p, downloaded: p.downloaded + ev.data.chunkLength }));
        } else if (ev.event === "Finished") {
          setPhase("installing");
        }
      });
      // No Windows o instalador encerra o app sozinho; nos demais SOs reiniciamos.
      await relaunch();
    } catch (e) {
      setError(String(e));
      setPhase("error");
    } finally {
      busyRef.current = false;
    }
  }, []);

  // Verificação automática: logo após abrir e a cada 30 min (app fica aberto o dia todo).
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const t = window.setTimeout(() => checkNow(false), PRIMEIRA_VERIFICACAO_MS);
    const iv = window.setInterval(() => checkNow(false), INTERVALO_VERIFICACAO_MS);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(iv);
    };
  }, [checkNow]);

  const value = useMemo<UpdaterContextValue>(
    () => ({
      phase,
      currentVersion,
      update,
      progress,
      error,
      lastCheck,
      modalOpen,
      openModal: () => setModalOpen(true),
      closeModal: () => setModalOpen(false),
      checkNow,
      install,
    }),
    [phase, currentVersion, update, progress, error, lastCheck, modalOpen, checkNow, install]
  );

  return <UpdaterContext.Provider value={value}>{children}</UpdaterContext.Provider>;
}

export function useUpdater() {
  const ctx = useContext(UpdaterContext);
  if (!ctx) throw new Error("useUpdater deve ser usado dentro de <UpdaterProvider>");
  return ctx;
}

export function formatBytes(n: number) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

