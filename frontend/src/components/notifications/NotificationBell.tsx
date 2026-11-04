"use client";

import { LoaderCircle } from "@/components/ui/GlobalLoading";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { apiRequest } from "@/lib/api";
import type { NotificationDestination } from "@/types/notification";
import { useAuth } from "@/components/auth/AuthProvider";

type NotificationRow = { id: string; type: string; title: string; message: string; entity?: string | null; entityId?: string | null; readAt?: string | null; createdAt: string; resolved?: boolean | null };
type DisplayRow = NotificationRow & { ids: string[]; unreadIds: string[] };
type StockDetail = { product: string; sku: string; warehouse: string; onHand: number; reserved: number; available: number; note?: string };
type Target = NotificationDestination | { page: "inventory-detail"; detail: StockDetail };
const actionableEntities = new Set(["QuarantineDecision", "InventoryBalance", "ProductBatch", "PurchaseOrder", "Sale", "StockAdjustment", "StockTransfer", "ReturnOrder", "StockTakeSession", "StockTakeLine", "Expense", "Payment", "SaleShipment"]);
const canOpen = (row: NotificationRow) => Boolean(row.entityId && row.entity && actionableEntities.has(row.entity));

export default function NotificationBell({ onOpen }: { onOpen: (target: NotificationDestination) => void }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState("");
  const [stockDetail, setStockDetail] = useState<StockDetail | null>(null);
  const [groupSame, setGroupSame] = useState(true);
  const loadVersion = useRef(0);
  const preferenceKey = `stockflow:notification-group:${user?.id ?? "guest"}`;
  useEffect(() => {
    const timer = window.setTimeout(() => { try { setGroupSame(localStorage.getItem(preferenceKey) !== "false"); } catch { setGroupSame(true); } }, 0);
    return () => window.clearTimeout(timer);
  }, [preferenceKey]);
  const displayRows = useMemo(() => {
    const groups = new Map<string, DisplayRow>();
    for (const row of rows) {
      const key = groupSame ? JSON.stringify([row.type, row.entity, row.entityId, row.title, row.message]) : row.id;
      const existing = groups.get(key);
      if (existing) { existing.ids.push(row.id); if (!row.readAt) existing.unreadIds.push(row.id); }
      else groups.set(key, { ...row, ids: [row.id], unreadIds: row.readAt ? [] : [row.id] });
    }
    return Array.from(groups.values());
  }, [rows, groupSame]);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (unreadOnly) params.set("unreadOnly", "true");
      const response = await apiRequest<{ data?: NotificationRow[]; unreadCount?: number; meta?: { totalPages: number } }>(`/api/notifications?${params}`);
      if (version === loadVersion.current) { setRows(Array.isArray(response.data) ? response.data.map((row) => row.resolved ? { ...row, title: `${row.title} · Status berubah`, message: `${row.message} Status dokumen telah berubah atau akses tidak lagi tersedia; periksa informasi terbaru.` } : row) : []); setUnreadCount(response.unreadCount ?? 0); setTotalPages(Math.max(1, response.meta?.totalPages ?? 1)); }
    } catch { /* Keep the rest of the application usable. */ }
  }, [page, unreadOnly]);

  useEffect(() => {
    const versionRef = loadVersion;
    const timer = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 30000);
    const refresh = () => void load(); window.addEventListener("stockflow:notifications", refresh);
    return () => { versionRef.current++; window.clearTimeout(timer); window.clearInterval(interval); window.removeEventListener("stockflow:notifications", refresh); };
  }, [load]);

  async function markRead(row: DisplayRow) {
    if (!row.unreadIds.length) return;
    await apiRequest("/api/notifications/read-batch", { method: "POST", body: JSON.stringify({ ids: row.unreadIds }) });
    await load();
  }
  async function openRow(row: DisplayRow) {
    setBusy(true); setError("");
    try {
      const result = await apiRequest<{ data: Target }>(`/api/notifications/${row.id}/target`);
      await markRead(row);
      setOpen(false);
      if (result.data.page === "inventory-detail") setStockDetail(result.data.detail);
      else onOpen(result.data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Dokumen tidak dapat dibuka."); }
    finally { setBusy(false); }
  }
  async function readOne(row: DisplayRow) { setBusy(true); setError(""); try { await markRead(row); } catch (reason) { setError(reason instanceof Error ? reason.message : "Notifikasi tidak dapat diperbarui."); } finally { setBusy(false); } }
  async function markAllRead() { setBusy(true); setError(""); try { await apiRequest("/api/notifications/read-all", { method: "POST" }); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Notifikasi tidak dapat diperbarui."); } finally { setBusy(false); } }

  return <div className="relative" data-sf-loading-ignore><button type="button" aria-label={`Notifikasi${unreadCount ? `, ${unreadCount} belum dibaca` : ""}`} aria-expanded={open} onClick={() => setOpen((value) => !value)} className="relative rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><Bell size={18} />{unreadCount > 0 && <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>}</button>
    {open && <div className="absolute right-0 top-14 z-50 w-[min(400px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800"><div><p className="text-sm font-bold text-slate-900 dark:text-white">Notifikasi</p><p className="text-xs text-slate-500">{unreadCount} belum dibaca</p></div><button type="button" disabled={busy || unreadCount === 0} onClick={() => void markAllRead()} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-blue-600 disabled:opacity-40"><CheckCheck size={14} /> Baca semua</button></div><div className="flex gap-2 border-b border-slate-100 px-4 py-2 dark:border-slate-800"><button type="button" onClick={() => { setUnreadOnly(false); setPage(1); }} className={`rounded-lg px-3 py-1 text-xs ${!unreadOnly ? "bg-blue-600 text-white" : "text-slate-500"}`}>Semua</button><button type="button" onClick={() => { setUnreadOnly(true); setPage(1); }} className={`rounded-lg px-3 py-1 text-xs ${unreadOnly ? "bg-blue-600 text-white" : "text-slate-500"}`}>Belum dibaca</button><label className="ml-auto flex items-center gap-1 text-[11px] text-slate-500"><input type="checkbox" checked={groupSame} onChange={(event) => { const value = event.target.checked; setGroupSame(value); try { localStorage.setItem(preferenceKey, String(value)); } catch {} }} /> Gabungkan duplikat di halaman ini</label></div>{error && <p role="alert" className="bg-red-50 px-4 py-2 text-xs text-red-700">{error}</p>}<div className="max-h-[min(400px,60vh)] overflow-y-auto">{displayRows.length === 0 && <p className="px-5 py-10 text-center text-sm text-slate-500">Tidak ada notifikasi pada filter ini.</p>}{displayRows.map((row) => <div key={row.id} className={`border-b border-slate-100 px-4 py-3 dark:border-slate-800 ${row.unreadIds.length ? "bg-blue-50/60 dark:bg-blue-950/20" : ""}`}><button type="button" disabled={busy || !canOpen(row)} onClick={() => void openRow(row)} className="block w-full text-left disabled:opacity-50"><span className="flex justify-between gap-2"><span className="text-sm font-semibold text-slate-900 dark:text-white">{row.title}{row.ids.length > 1 && ` ×${row.ids.length}`}</span><span className="shrink-0 text-[10px] text-slate-400">{new Date(row.createdAt).toLocaleString("id-ID")}</span></span><span className="mt-1 block text-xs leading-5 text-slate-600 dark:text-slate-300">{row.message}</span></button><div className="mt-2 flex justify-between text-xs"><span className="text-slate-400">{canOpen(row) ? "Klik untuk membuka" : "Informasi · tautan langsung tidak tersedia"}</span>{row.unreadIds.length > 0 && <button type="button" disabled={busy} onClick={() => void readOne(row)} className="font-semibold text-blue-600 disabled:opacity-40">Tandai dibaca</button>}</div></div>)}</div><div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800"><button type="button" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)} className="disabled:opacity-40">Sebelumnya</button><span>{busy && <LoaderCircle size={12} className="mr-1 inline animate-spin" />}Halaman {page} / {totalPages}</span><button type="button" disabled={page >= totalPages || busy} onClick={() => setPage(page + 1)} className="disabled:opacity-40">Berikutnya</button></div></div>}
    {stockDetail && <div className="sf-modal-overlay fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4"><div role="dialog" aria-modal="true" aria-label="Detail stok" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900"><div className="flex justify-between"><div><h3 className="font-bold text-slate-900 dark:text-white">{stockDetail.product}</h3><p className="text-xs text-slate-500">{stockDetail.sku} · {stockDetail.warehouse}</p></div><button type="button" onClick={() => setStockDetail(null)} aria-label="Tutup"><X size={18} /></button></div><p className="mt-5 text-sm dark:text-slate-200">Fisik: {stockDetail.onHand} · Reservasi: {stockDetail.reserved} · <strong>Tersedia: {stockDetail.available}</strong></p>{stockDetail.note && <p className="mt-3 text-sm text-slate-500 dark:text-slate-300">{stockDetail.note}</p>}</div></div>}
  </div>;
}
