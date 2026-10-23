"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCheck, ClipboardCheck, Info } from "lucide-react";
import { apiRequest } from "@/lib/api";

type Notice = { id: string; type: string; title: string; message: string; createdAt: string; readAt?: string | null };

export default function NotificationFeed() {
  const [items, setItems] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  async function load() { try { const result = await apiRequest<{ data?: Notice[]; unreadCount?: number }>("/api/notifications?page=1&pageSize=10"); setItems(Array.isArray(result.data) ? result.data : []); setUnread(Number(result.unreadCount) || 0); } catch { setItems([]); setUnread(0); } }
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer);
  }, []);
  async function mark(id: string) { await apiRequest(`/api/notifications/${id}/read`, { method: "PATCH", body: JSON.stringify({}) }); await load(); }
  async function markAll() { await apiRequest("/api/notifications/read-all", { method: "POST", body: JSON.stringify({}) }); await load(); }
  const icon = (type: string) => type === "LOW_STOCK" ? <AlertTriangle size={16} className="text-amber-500" /> : type === "APPROVAL_REQUIRED" ? <ClipboardCheck size={16} className="text-blue-500" /> : <Info size={16} className="text-slate-500" />;
  return <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-500">Operational alerts</p><h3 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">Notification center {unread > 0 && <span className="ml-2 rounded-full bg-red-100 px-2 py-1 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">{unread} new</span>}</h3><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Low stock and approval items generated from live warehouse data.</p></div>{unread > 0 && <button type="button" onClick={() => void markAll()} className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"><CheckCheck size={15} /> Mark all read</button>}</div><div className="mt-4 grid gap-2 md:grid-cols-2">{items.slice(0, 6).map((item) => <button key={item.id} type="button" onClick={() => !item.readAt && void mark(item.id)} className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 ${item.readAt ? "border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/40" : "border-blue-100 bg-blue-50/60 dark:border-blue-900/60 dark:bg-blue-950/20"}`}>{icon(item.type)}<span className="min-w-0"><span className="block text-sm font-bold text-slate-800 dark:text-white">{item.title}</span><span className="mt-1 block text-xs text-slate-500 dark:text-slate-300">{item.message}</span></span></button>)}{items.length === 0 && <p className="py-6 text-center text-sm text-emerald-700 dark:text-emerald-300 md:col-span-2">No active alerts.</p>}</div></section>;
}

