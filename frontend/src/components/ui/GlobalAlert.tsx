"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

type AlertTone = "warning" | "danger" | "success" | "error" | "info";
type AlertOptions = { title?: string; tone?: AlertTone; confirmLabel?: string; cancelLabel?: string; action?: { label: string; onClick: () => void } };
type AlertRequest = { message: string; options: AlertOptions; confirm: boolean; resolve: (value: boolean) => void };
const eventName = "stockflow:global-alert";

function requestAlert(message: string, options: AlertOptions, confirm: boolean): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent<AlertRequest>(eventName, { detail: { message, options, confirm, resolve } })));
}

export function confirmAction(message: string, options: AlertOptions = {}) {
  const danger = /delete|hapus permanen|permanently delete/i.test(message) && !/tidak akan dihapus|not.*delet/i.test(message);
  const deactivate = /deactivate|nonaktifkan/i.test(message);
  const cancel = /cancel|batalkan/i.test(message) && !deactivate;
  return requestAlert(message, {
    tone: danger ? "danger" : "warning",
    ...(danger ? { title: "Konfirmasi penghapusan", confirmLabel: "Ya, hapus" } : deactivate ? { title: "Nonaktifkan data?", confirmLabel: "Ya, nonaktifkan" } : cancel ? { title: "Konfirmasi pembatalan", confirmLabel: "Ya, lanjutkan" } : {}),
    ...options,
  }, true);
}

export function showAlert(message: string, options: AlertOptions = {}) {
  return requestAlert(message, { tone: "info", ...options }, false);
}

export function showFeedback(message: string, tone: "success" | "error" | "info", action?: { label: string; onClick: () => void }) {
  const title = tone === "success" ? "Aksi berhasil" : tone === "error" ? "Aksi gagal" : "Informasi";
  return showAlert(message, { tone, title, confirmLabel: action?.label ?? "Tutup", action });
}

export function GlobalAlertProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<AlertRequest | null>(null);
  const queue = useRef<AlertRequest[]>([]);
  const current = useRef<AlertRequest | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const presentNext = () => {
      if (current.current || queue.current.length === 0) return;
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      current.current = queue.current.shift() ?? null;
      setActive(current.current);
    };
    const handleRequest = (event: Event) => { queue.current.push((event as CustomEvent<AlertRequest>).detail); presentNext(); };
    window.addEventListener(eventName, handleRequest);
    return () => {
      window.removeEventListener(eventName, handleRequest);
      current.current?.resolve(false);
      queue.current.forEach((request) => request.resolve(false));
      current.current = null;
      queue.current = [];
    };
  }, []);

  useEffect(() => { if (active) cancelRef.current?.focus(); }, [active]);

  function close(value: boolean) {
    const request = current.current;
    if (!request) return;
    request.resolve(value);
    if (value) request.options.action?.onClick();
    current.current = queue.current.shift() ?? null;
    setActive(current.current);
    if (!current.current) previousFocus.current?.focus();
  }

  const tone = active?.options.tone ?? "info";
  const toneStyles = {
    warning: { icon: AlertTriangle, color: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", button: "bg-amber-600 hover:bg-amber-700", title: "Konfirmasi tindakan" },
    danger: { icon: AlertTriangle, color: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300", button: "bg-rose-600 hover:bg-rose-700", title: "Konfirmasi penghapusan" },
    success: { icon: CheckCircle2, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", button: "bg-emerald-600 hover:bg-emerald-700", title: "Berhasil" },
    error: { icon: XCircle, color: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300", button: "bg-rose-600 hover:bg-rose-700", title: "Terjadi kesalahan" },
    info: { icon: Info, color: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300", button: "bg-blue-600 hover:bg-blue-700", title: "Informasi" },
  }[tone];
  const Icon = toneStyles.icon;

  return <>{children}{active && <div className="sf-modal-overlay fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(false); } if (event.key === "Tab") { const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"); if (buttons.length && ((event.shiftKey && document.activeElement === buttons[0]) || (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]))) { event.preventDefault(); (event.shiftKey ? buttons[buttons.length - 1] : buttons[0]).focus(); } } }}><div role="alertdialog" aria-modal="true" aria-labelledby="global-alert-title" aria-describedby="global-alert-message" className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"><div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${toneStyles.color}`}><Icon size={27} aria-hidden="true" /></div><h2 id="global-alert-title" className="mt-5 text-xl font-bold text-slate-900 dark:text-white">{active.options.title ?? toneStyles.title}</h2><p id="global-alert-message" className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-slate-300">{active.message}</p><div className="mt-6 flex flex-wrap justify-end gap-3">{active.confirm && <button ref={cancelRef} type="button" onClick={() => close(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">{active.options.cancelLabel ?? "Batal"}</button>}<button ref={!active.confirm ? cancelRef : undefined} type="button" onClick={() => close(true)} className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white ${toneStyles.button}`}>{active.options.confirmLabel ?? (active.confirm ? "Ya, lanjutkan" : "Mengerti")}</button></div></div></div>}</>;
}
