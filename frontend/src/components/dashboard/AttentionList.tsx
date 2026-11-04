"use client";
import { useApiQuery } from "@/hooks/useApiQuery";
import type { NotificationDestination, NotificationPage } from "@/types/notification";

type Attention = { days: number; rows: { id: string; number: string; status: string; updatedAt: string; label: string; page: NotificationPage }[] };
export default function AttentionList({ onOpen }: { onOpen: (target: NotificationDestination) => void }) {
  const { data, loading, error } = useApiQuery<Attention>("/api/operations/attention");
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900"><h3 className="font-bold">Transaksi perlu perhatian</h3><p className="mt-1 text-xs text-slate-500">Dokumen tanpa perubahan selama {data?.days ?? 7} hari; maksimal 10 per jenis, sesuai hak akses dan gudang Anda.</p>{loading ? <p className="mt-4 text-sm text-slate-500">Memuat…</p> : error ? <p role="alert" className="mt-4 text-sm text-red-600">Daftar tidak dapat dimuat.</p> : !data?.rows.length ? <p className="mt-4 text-sm text-slate-500">Tidak ada transaksi tertahan pada kriteria ini.</p> : <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-700">{data.rows.map((row) => <button key={`${row.page}:${row.id}`} type="button" onClick={() => onOpen({ page: row.page, recordId: row.id, reference: row.number })} className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left text-sm hover:text-blue-600"><span><strong>{row.number}</strong><span className="ml-2 text-xs text-slate-500">{row.label} · {row.status.replaceAll("_", " ")}</span></span><span className="text-xs text-slate-500">Terakhir diubah {new Date(row.updatedAt).toLocaleDateString("id-ID")} →</span></button>)}</div>}</section>;
}
