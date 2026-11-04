"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";

export type DataColumn<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
};

export default function DataTable<T extends { id: string }>({
  rows,
  columns,
  search,
  onSearch,
  searchPlaceholder = "Cari data...",
  empty = "Belum ada data untuk ditampilkan.",
  loading = false,
  error,
  onRetry,
}: {
  rows: T[];
  columns: DataColumn<T>[];
  search?: string;
  onSearch?: (value: string) => void;
  searchPlaceholder?: string;
  empty?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
    {(onSearch || search !== undefined) && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-700"><div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><SlidersHorizontal size={16} className="text-blue-600" /> Cari dan kelola data</div><div className="relative w-full sm:w-72"><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input aria-label="Cari data" value={search ?? ""} onChange={(event) => onSearch?.(event.target.value)} placeholder={searchPlaceholder} className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /></div></div>}
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-800"><span>{error}</span>{onRetry && <button type="button" onClick={onRetry} className="font-bold underline underline-offset-2">Coba lagi</button>}</div>}
    <div className="overflow-x-auto"><table aria-busy={loading} className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr>{columns.map((column) => <th key={column.key} scope="col" className={`px-5 py-3 font-bold ${column.className ?? ""}`}>{column.header}</th>)}</tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-700">{loading ? Array.from({ length: 4 }, (_, row) => <tr key={row} aria-hidden="true">{columns.map((column) => <td key={column.key} className="px-5 py-5"><span className="sf-skeleton block h-3 w-3/4 rounded-full" /></td>)}</tr>) : rows.map((row) => <tr key={row.id} className="sf-data-row text-slate-800 transition hover:bg-blue-50/70 dark:text-slate-100 dark:hover:bg-slate-800">{columns.map((column) => <td key={column.key} className={`px-5 py-4 ${column.className ?? ""}`}>{column.render(row)}</td>)}</tr>)}</tbody></table>{loading && <p role="status" className="sr-only">Memuat data…</p>}{!loading && rows.length === 0 && <div className="sf-appear px-5 py-14 text-center text-sm text-slate-600 dark:text-slate-300">{empty}</div>}</div>
  </div>;
}
