"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "@/components/ui/GlobalLoading";
import type { ActionRequestEvent } from "@/components/ui/GlobalActionLoading";

/** Visible only while a user-triggered API mutation is actually in flight. */
export default function GlobalMutationStatus() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const active = new Set<string>();
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<ActionRequestEvent>).detail;
      if (!detail || ["GET", "HEAD", "OPTIONS"].includes(detail.method) || /^\/api\/(auth|notifications)(\/|\?|$)/.test(detail.endpoint)) return;
      if (detail.phase === "start") active.add(detail.id);
      else active.delete(detail.id);
      setCount(active.size);
    };
    window.addEventListener("stockflow:action-request", listener);
    return () => window.removeEventListener("stockflow:action-request", listener);
  }, []);
  if (!count) return null;
  return <div role="status" aria-live="polite" className="fixed bottom-5 right-5 z-[2000] flex items-center gap-3 rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-lg dark:border-slate-600 dark:bg-slate-900 dark:text-white"><LoaderCircle size={18} className="animate-spin text-blue-600" /><span>Menyimpan perubahan...</span></div>;
}
