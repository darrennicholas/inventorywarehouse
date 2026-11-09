"use client";

import { CheckCircle2, X, XCircle } from "lucide-react";

export default function ActionFeedback({ message, tone, onDismiss, action }: { message: string; tone: "success" | "error" | "info"; onDismiss?: () => void; action?: { label: string; onClick: () => void } }) {
  if (!message) return null;
  const success = tone === "success";
  const Icon = success ? CheckCircle2 : XCircle;
  const colors = success ? "border-emerald-200 bg-emerald-50 text-emerald-800" : tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-blue-200 bg-blue-50 text-blue-800";
  return <div role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"} className={`flex flex-wrap items-start gap-2 rounded-xl border px-4 py-3 text-sm ${colors}`}><Icon size={17} className="mt-0.5 shrink-0" aria-hidden="true" /><p className="min-w-0 flex-1">{message}</p>{action && <button type="button" onClick={action.onClick} className="font-semibold underline underline-offset-2">{action.label}</button>}{onDismiss && <button type="button" onClick={onDismiss} aria-label="Tutup pesan" className="rounded-md p-1 opacity-70 transition hover:bg-black/5 hover:opacity-100"><X size={15} /></button>}</div>;
}
