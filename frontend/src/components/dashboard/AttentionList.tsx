"use client";
import { useState } from "react";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useAuth } from "@/components/auth/AuthProvider";
import { statusLabel } from "@/lib/ui-labels";
import type { NotificationDestination, NotificationPage } from "@/types/notification";

type Attention = { days: number; total: number; page: number; pageSize: number; rows: { id: string; number: string; status: string; updatedAt: string; label: string; page: NotificationPage }[] };
const kinds = [["purchases", "Purchase"], ["sales", "Sale"], ["transfers", "Transfer"], ["stock-opnames", "Stock opname"]] as const;
export default function AttentionList({ onOpen }: { onOpen: (target: NotificationDestination) => void }) {
  const { can } = useAuth();
  const available = kinds.filter(([value]) => can(`${value}.read`));
  const [selected, setSelected] = useState(""); const [page, setPage] = useState(1); const [search, setSearch] = useState("");
  const kind = available.some(([value]) => value === selected) ? selected : available[0]?.[0];
  const params = new URLSearchParams({ kind: kind ?? "purchases", page: String(page), search });
  const { data, loading, error } = useApiQuery<Attention>(`/api/operations/attention?${params}`, Boolean(kind));
  if (!kind) return null;
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900"><h3 className="font-bold">Transaksi perlu perhatian</h3><p className="mt-1 text-xs text-slate-500">Dokumen tanpa perubahan selama {data?.days ?? 7} hari, sesuai hak akses dan gudang Anda.</p><div className="mt-3 flex flex-wrap gap-2"><select aria-label="Jenis transaksi" value={kind} onChange={(event) => { setSelected(event.target.value); setPage(1); }} className="rounded border p-2 dark:bg-slate-800">{available.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input aria-label="Cari nomor transaksi" placeholder="Cari nomor transaksi" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="rounded border p-2 dark:bg-slate-800" /></div>{loading ? <p className="mt-4 text-sm text-slate-500">Memuat…</p> : error ? <p role="alert" className="mt-4 text-sm text-red-600">Daftar tidak dapat dimuat.</p> : !data?.rows.length ? <p className="mt-4 text-sm text-slate-500">Tidak ada transaksi tertahan pada kriteria ini.</p> : <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-700">{data.rows.map((row) => <button key={`${row.page}:${row.id}`} type="button" onClick={() => onOpen({ page: row.page, recordId: row.id, reference: row.number })} className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left text-sm hover:text-blue-600"><span><strong>{row.number}</strong><span className="ml-2 text-xs text-slate-500">{row.label} · {statusLabel(row.status)}</span></span><span className="text-xs text-slate-500">Terakhir diubah {new Date(row.updatedAt).toLocaleDateString("id-ID")} →</span></button>)}</div>}{data && <div className="mt-3 flex items-center gap-3 text-xs"><span>{data.total} transaksi · Halaman {page}</span><button type="button" disabled={loading || page <= 1} onClick={() => setPage(page - 1)} className="rounded border px-2 py-1 disabled:opacity-40">Sebelumnya</button><button type="button" disabled={loading || page * data.pageSize >= data.total} onClick={() => setPage(page + 1)} className="rounded border px-2 py-1 disabled:opacity-40">Berikutnya</button></div>}</section>;
}
