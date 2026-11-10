"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
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
  const isActionColumn = (column: DataColumn<T>) => /^(?:actions?|aksi|tindakan)$/i.test(column.header.trim());
  const orderedColumns = [
    ...columns.filter(isActionColumn),
    ...columns.filter((column) => !isActionColumn(column)),
  ];

  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
    {(onSearch || search !== undefined) && <div className="sf-filter-toolbar flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-700"><div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><SlidersHorizontal size={16} className="text-blue-600" /> Cari dan kelola data</div><div className="relative w-full sm:w-72"><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input aria-label="Cari data" value={search ?? ""} onChange={(event) => onSearch?.(event.target.value)} placeholder={searchPlaceholder} className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-10 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />{search && onSearch && <button type="button" aria-label="Hapus pencarian" onClick={() => onSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700"><X size={15} /></button>}</div></div>}
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-800"><span>{error}</span>{onRetry && <button type="button" onClick={onRetry} className="font-bold underline underline-offset-2">Coba lagi</button>}</div>}
    <div aria-busy={loading}>
      <div className="divide-y divide-slate-100 dark:divide-slate-700 md:hidden">
        {loading ? Array.from({ length: 4 }, (_, row) => <div key={row} aria-hidden="true" className="space-y-3 p-4">{orderedColumns.map((column) => <span key={column.key} className="sf-skeleton block h-3 w-3/4 rounded-full" />)}</div>) : rows.map((row) => <article key={row.id} className="sf-data-row space-y-3 p-4 text-sm text-slate-800 dark:text-slate-100">
          {orderedColumns.map((column, index) => {
            const actionColumn = isActionColumn(column);
            return <div key={column.key} data-sf-action-column={actionColumn ? "" : undefined} className={`flex min-w-0 gap-3 ${actionColumn ? "flex-col items-start" : "items-start justify-between"} ${index === 0 ? "border-b border-slate-100 pb-3 dark:border-slate-700" : ""}`}>
              <span className="shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">{column.header}</span>
              <div className={`min-w-0 ${actionColumn ? "text-left" : "text-right"}`}>{column.render(row)}</div>
            </div>;
          })}
        </article>)}
      </div>
      <div role="region" aria-label={`Tabel data: ${orderedColumns.map((column) => column.header).join(", ")}`} tabIndex={0} className="sf-table-scroll hidden md:block"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr>{orderedColumns.map((column) => <th key={column.key} scope="col" className={`px-4 py-3 font-bold ${isActionColumn(column) ? "w-[1%] whitespace-nowrap text-left" : ""} ${column.className ?? ""}`}>{column.header}</th>)}</tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-700">{loading ? Array.from({ length: 4 }, (_, row) => <tr key={row} aria-hidden="true">{orderedColumns.map((column) => <td key={column.key} className="px-4 py-4"><span className="sf-skeleton block h-3 w-3/4 rounded-full" /></td>)}</tr>) : rows.map((row) => <tr key={row.id} className="sf-data-row text-slate-800 transition hover:bg-blue-50/70 dark:text-slate-100 dark:hover:bg-slate-800">{orderedColumns.map((column) => <td key={column.key} data-sf-action-column={isActionColumn(column) ? "" : undefined} className={`px-4 py-3 align-middle ${isActionColumn(column) ? "text-left" : ""} ${column.className ?? ""}`}>{isActionColumn(column) ? <div className="flex justify-start">{column.render(row)}</div> : column.render(row)}</td>)}</tr>)}</tbody></table></div>
      {loading && <p role="status" className="sr-only">Memuat data…</p>}{!loading && rows.length === 0 && <div className="sf-appear px-5 py-14 text-center text-sm text-slate-600 dark:text-slate-300">{empty}</div>}
    </div>
  </div>;
}
