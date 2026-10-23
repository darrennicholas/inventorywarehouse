"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, LoaderCircle } from "lucide-react";

import { apiRequest } from "@/lib/api";

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  entity?: string | null;
  entityId?: string | null;
  readAt?: string | null;
  createdAt: string;
};

function relativeTime(value: string) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const response = await apiRequest<{ data?: NotificationRow[]; unreadCount?: number }>("/api/notifications");
      setRows(Array.isArray(response.data) ? response.data : []);
      setUnreadCount(response.unreadCount ?? 0);
    } catch {
      // Notification delivery must never make the main application unusable.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 30000);
    const refreshNow = () => void load();
    window.addEventListener("stockflow:notifications", refreshNow);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener("stockflow:notifications", refreshNow);
    };
  }, [load]);

  async function markRead(id: string) {
    try {
      await apiRequest(`/api/notifications/${id}/read`, { method: "PATCH" });
      setRows((current) => current.map((row) => row.id === id ? { ...row, readAt: new Date().toISOString() } : row));
      setUnreadCount((current) => Math.max(0, current - 1));
    } catch {
      // Keep the notification visible if the request failed.
    }
  }

  async function markAllRead() {
    setLoading(true);
    try {
      await apiRequest("/api/notifications/read-all", { method: "POST" });
      setRows((current) => current.map((row) => ({ ...row, readAt: row.readAt ?? new Date().toISOString() })));
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="relative rounded-xl border border-slate-200 p-2.5 text-slate-500 transition hover:-translate-y-0.5 hover:bg-white hover:text-[#2965ec] dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <Bell size={18} />
        {unreadCount > 0 && <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-950">{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-14 z-50 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div><p className="text-sm font-bold text-slate-900 dark:text-white">Activity notifications</p><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Updates from your accessible modules</p></div>
            <button type="button" onClick={() => void markAllRead()} disabled={loading || unreadCount === 0} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-40 dark:hover:bg-blue-950/40"><CheckCheck size={14} /> Read all</button>
          </div>
          <div className="max-h-[min(440px,70vh)] overflow-y-auto">
            {rows.length === 0 && <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">No notifications yet.</div>}
            {rows.map((row) => <button key={row.id} type="button" onClick={() => !row.readAt && void markRead(row.id)} className={`block w-full border-b border-slate-100 px-4 py-3 text-left transition last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/70 ${row.readAt ? "opacity-70" : "bg-blue-50/60 dark:bg-blue-950/20"}`}><div className="flex gap-3"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${row.readAt ? "bg-slate-300" : "bg-blue-500"}`} /><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-slate-900 dark:text-white">{row.title}</span><span className="shrink-0 text-[10px] text-slate-400">{relativeTime(row.createdAt)}</span></span><span className="mt-1 block text-xs leading-5 text-slate-600 dark:text-slate-300">{row.message}</span></span></div></button>)}
          </div>
          {loading && <div className="flex items-center justify-center gap-2 border-t border-slate-100 py-2 text-xs text-slate-400 dark:border-slate-800"><LoaderCircle size={13} className="animate-spin" /> Updating</div>}
        </div>
      )}
    </div>
  );
}

