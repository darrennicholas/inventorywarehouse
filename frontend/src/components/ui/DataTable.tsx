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
  searchPlaceholder = "Search records...",
  empty = "No records found",
  loading = false,
}: {
  rows: T[];
  columns: DataColumn<T>[];
  search?: string;
  onSearch?: (value: string) => void;
  searchPlaceholder?: string;
  empty?: string;
  loading?: boolean;
}) {
  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    {(onSearch || search !== undefined) && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><div className="flex items-center gap-2 text-sm font-semibold text-slate-700"><SlidersHorizontal size={16} className="text-blue-600" /> Data explorer</div><div className="relative w-full sm:w-72"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search ?? ""} onChange={(event) => onSearch?.(event.target.value)} placeholder={searchPlaceholder} className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></div></div>}
    <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{columns.map((column) => <th key={column.key} className={`px-5 py-3 font-bold ${column.className ?? ""}`}>{column.header}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{loading ? <tr><td colSpan={columns.length} className="px-5 py-12 text-center text-slate-400">Loading records...</td></tr> : rows.map((row) => <tr key={row.id} className="transition hover:bg-blue-50/40">{columns.map((column) => <td key={column.key} className={`px-5 py-4 ${column.className ?? ""}`}>{column.render(row)}</td>)}</tr>)}</tbody></table>{!loading && rows.length === 0 && <div className="px-5 py-14 text-center text-sm text-slate-400">{empty}</div>}</div>
  </div>;
}
