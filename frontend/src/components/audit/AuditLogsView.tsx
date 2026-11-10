"use client";

import ActionIconButton from "@/components/ui/ActionIconButton";
import { Eye } from "lucide-react";
import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import DataTable from "@/components/ui/DataTable";
import { apiDownload, apiRequest } from "@/lib/api";
import DataPagination from "@/components/ui/DataPagination";
import ActionFeedback from "@/components/ui/ActionFeedback";
import { actionLabel } from "@/lib/ui-labels";

type AuditRow = { id: string; action: string; entity: string; entityId: string | null; beforeData: unknown; afterData: unknown; createdAt: string; user?: { fullName: string; email: string } | null };
type Filters = { search: string; entity: string; action: string; fromDate: string; toDate: string };
type Meta = { page: number; total: number; totalPages: number };
const emptyFilters: Filters = { search: "", entity: "", action: "", fromDate: "", toDate: "" };
function queryFor(filters: Filters) { const result = new URLSearchParams(); for (const [key, value] of Object.entries(filters)) if (value.trim()) result.set(key, value.trim()); return result; }

export default function AuditLogsView() {
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<AuditRow | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const params = queryFor(filters); params.set("page", String(page)); params.set("pageSize", String(pageSize));
    const timer = window.setTimeout(() => { setLoading(true); setError(""); void apiRequest<{ data: AuditRow[]; meta: Meta }>(`/api/audit-logs?${params}`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) { setRows(result.data ?? []); setMeta(result.meta); } }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Gagal memuat audit log."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [filters, page, pageSize]);
  function apply() { if (draft.fromDate && draft.toDate && draft.fromDate > draft.toDate) { setError("Tanggal awal harus sebelum atau sama dengan tanggal akhir."); return; } setError(""); setPage(1); setFilters({ ...draft }); }
  function reset() { setDraft(emptyFilters); setFilters(emptyFilters); setPage(1); setError(""); }
  async function exportCsv() { setExporting(true); setError(""); setNotice(""); try { const blob = await apiDownload(`/api/audit-logs/export.csv?${queryFor(filters)}`); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "audit-log.csv"; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("Audit log berhasil diekspor."); } catch (reason) { setError(reason instanceof Error ? reason.message : "Gagal mengunduh audit log."); } finally { setExporting(false); } }
  const input = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white";
  return <section className="space-y-5"><div className="sf-page-hero rounded-3xl bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-800 p-6 text-white shadow-lg"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-blue-200">Pusat pengawasan</p><h2 className="mt-2 text-3xl font-bold">Riwayat audit</h2><p className="mt-2 text-sm text-blue-100">Lihat perubahan dan keputusan yang tercatat dalam sistem.</p></div><button type="button" onClick={() => void exportCsv()} disabled={exporting} className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2.5 text-sm font-semibold disabled:opacity-50"><Download size={16} /> {exporting ? "Mengunduh..." : "Ekspor CSV"}</button></div></div>
    <div className="sf-filter-toolbar rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{([['search', 'Cari aksi, entitas, atau pengguna'], ['entity', 'Entitas'], ['action', 'Aksi'], ['fromDate', 'Dari tanggal'], ['toDate', 'Sampai tanggal']] as const).map(([key, label]) => <label key={key} className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}<input className={`${input} mt-1`} type={key.endsWith('Date') ? 'date' : 'text'} value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} /></label>)}</div><div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" onClick={apply} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Terapkan filter</button><button type="button" onClick={reset} className="rounded-lg border border-slate-200 px-4 py-2 text-sm dark:border-slate-600">Reset</button><span className="text-xs text-slate-500">CSV mencakup semua hasil filter, bukan hanya halaman ini. Waktu filter menggunakan WIB.</span></div></div>
    {error && <ActionFeedback message={error} tone="error" onDismiss={() => setError("")} />}
    {notice && <ActionFeedback message={notice} tone="success" onDismiss={() => setNotice("")} />}
    <DataTable rows={rows} loading={loading} empty="Tidak ada aktivitas untuk filter ini." columns={[{ key: "date", header: "Waktu", render: (row) => <span className="whitespace-nowrap text-slate-500">{new Date(row.createdAt).toLocaleString("id-ID")}</span> }, { key: "action", header: "Aktivitas", render: (row) => <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{actionLabel(row.action)}</span> }, { key: "entity", header: "Data", render: (row) => <div><p className="font-bold text-slate-800">{row.entity}</p><p className="text-xs text-slate-400">{row.entityId ?? "—"}</p></div> }, { key: "user", header: "Pelaku", render: (row) => <div><p className="font-semibold text-slate-700">{row.user?.fullName ?? "Sistem"}</p><p className="text-xs text-slate-400">{row.user?.email ?? "Proses otomatis"}</p></div> }, { key: "view", header: "Aksi", render: (row) => <ActionIconButton label={`Lihat rincian aktivitas ${actionLabel(row.action)} pada ${row.entity}`} icon={Eye} onClick={() => setSelected(row)} /> }]} />
    {meta && <DataPagination page={page} pageSize={pageSize} total={meta.total} totalPages={meta.totalPages} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} loading={loading} noun="catatan audit" />}
    {selected && <div className="sf-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><div role="dialog" aria-modal="true" aria-label="Rincian audit" className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase text-blue-600">Rincian audit</p><h3 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{selected.action} · {selected.entity}</h3></div><button type="button" onClick={() => setSelected(null)} aria-label="Tutup" className="rounded-lg p-2 text-slate-400"><X size={18} /></button></div><pre className="mt-5 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-emerald-300">{JSON.stringify({ before: selected.beforeData, after: selected.afterData }, null, 2)}</pre></div></div>}
  </section>;
}
