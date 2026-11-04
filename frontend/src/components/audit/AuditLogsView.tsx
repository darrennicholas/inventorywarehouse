"use client";

import { Eye } from "@/components/ui/ActionIcons";
import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import DataTable from "@/components/ui/DataTable";
import { apiDownload, apiRequest } from "@/lib/api";

type AuditRow = { id: string; action: string; entity: string; entityId: string | null; beforeData: unknown; afterData: unknown; createdAt: string; user?: { fullName: string; email: string } | null };
type Filters = { search: string; entity: string; action: string; fromDate: string; toDate: string };
type Meta = { page: number; total: number; totalPages: number };
const emptyFilters: Filters = { search: "", entity: "", action: "", fromDate: "", toDate: "" };
function queryFor(filters: Filters) { const result = new URLSearchParams(); for (const [key, value] of Object.entries(filters)) if (value.trim()) result.set(key, value.trim()); return result; }

export default function AuditLogsView() {
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<AuditRow | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const params = queryFor(filters); params.set("page", String(page)); params.set("pageSize", "25");
    const timer = window.setTimeout(() => { setLoading(true); setError(""); void apiRequest<{ data: AuditRow[]; meta: Meta }>(`/api/audit-logs?${params}`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) { setRows(result.data ?? []); setMeta(result.meta); } }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Gagal memuat audit log."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [filters, page]);
  function apply() { if (draft.fromDate && draft.toDate && draft.fromDate > draft.toDate) { setError("Tanggal awal harus sebelum atau sama dengan tanggal akhir."); return; } setError(""); setPage(1); setFilters({ ...draft }); }
  function reset() { setDraft(emptyFilters); setFilters(emptyFilters); setPage(1); setError(""); }
  async function exportCsv() { setExporting(true); setError(""); try { const blob = await apiDownload(`/api/audit-logs/export.csv?${queryFor(filters)}`); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "audit-log.csv"; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (reason) { setError(reason instanceof Error ? reason.message : "Gagal mengunduh audit log."); } finally { setExporting(false); } }
  const input = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white";
  return <section className="space-y-5"><div className="rounded-3xl bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-800 p-6 text-white shadow-lg"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-blue-200">Governance center</p><h2 className="mt-2 text-3xl font-bold">Audit timeline</h2><p className="mt-2 text-sm text-blue-100">Lihat perubahan dan keputusan yang tercatat dalam sistem.</p></div><button type="button" onClick={() => void exportCsv()} disabled={exporting} className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2.5 text-sm font-semibold disabled:opacity-50"><Download size={16} /> {exporting ? "Mengunduh..." : "Export CSV"}</button></div></div>
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{([['search', 'Cari aksi, entitas, atau pengguna'], ['entity', 'Entitas'], ['action', 'Aksi'], ['fromDate', 'Dari tanggal'], ['toDate', 'Sampai tanggal']] as const).map(([key, label]) => <label key={key} className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}<input className={`${input} mt-1`} type={key.endsWith('Date') ? 'date' : 'text'} value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} /></label>)}</div><div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" onClick={apply} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Terapkan filter</button><button type="button" onClick={reset} className="rounded-lg border border-slate-200 px-4 py-2 text-sm dark:border-slate-600">Reset</button><span className="text-xs text-slate-500">CSV mencakup semua hasil filter, bukan hanya halaman ini. Waktu filter menggunakan WIB.</span></div></div>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
    <DataTable rows={rows} loading={loading} empty="Tidak ada aktivitas untuk filter ini." columns={[{ key: "date", header: "Timestamp", render: (row) => <span className="whitespace-nowrap text-slate-500">{new Date(row.createdAt).toLocaleString("id-ID")}</span> }, { key: "action", header: "Action", render: (row) => <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{row.action}</span> }, { key: "entity", header: "Entity", render: (row) => <div><p className="font-bold text-slate-800">{row.entity}</p><p className="text-xs text-slate-400">{row.entityId ?? "—"}</p></div> }, { key: "user", header: "Actor", render: (row) => <div><p className="font-semibold text-slate-700">{row.user?.fullName ?? "System"}</p><p className="text-xs text-slate-400">{row.user?.email ?? "Automated process"}</p></div> }, { key: "view", header: "Detail", render: (row) => <button type="button" onClick={() => setSelected(row)} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700"><Eye size={14} /> View</button> }]} />
    {meta && <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Sebelumnya</button><span>Halaman {page} / {Math.max(1, meta.totalPages)} · {meta.total} catatan</span><button type="button" disabled={page >= meta.totalPages || loading} onClick={() => setPage(page + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Berikutnya</button></div>}
    {selected && <div className="sf-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><div role="dialog" aria-modal="true" aria-label="Audit detail" className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase text-blue-600">Audit detail</p><h3 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{selected.action} · {selected.entity}</h3></div><button type="button" onClick={() => setSelected(null)} aria-label="Tutup" className="rounded-lg p-2 text-slate-400"><X size={18} /></button></div><pre className="mt-5 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-emerald-300">{JSON.stringify({ before: selected.beforeData, after: selected.afterData }, null, 2)}</pre></div></div>}
  </section>;
}
