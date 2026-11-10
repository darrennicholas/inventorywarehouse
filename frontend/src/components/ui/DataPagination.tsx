"use client";

import GlobalSelect from "@/components/ui/GlobalSelect";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function DataPagination({ page, pageSize, total, totalPages, onPageChange, onPageSizeChange, pageSizeOptions = [10, 25, 50], loading = false, noun = "data" }: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  loading?: boolean;
  noun?: string;
}) {
  const safeTotalPages = Math.max(1, totalPages);
  const currentPage = Math.min(Math.max(1, page), safeTotalPages);
  const from = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, total);
  return <nav aria-label="Navigasi halaman data" className="flex min-w-0 flex-col gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between sm:px-5">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span>Menampilkan <strong className="text-slate-700 dark:text-slate-200">{from}–{to}</strong> dari <strong className="text-slate-700 dark:text-slate-200">{total}</strong> {noun}</span>
      {onPageSizeChange && <label className="flex items-center gap-2">Baris per halaman<GlobalSelect aria-label="Baris per halaman" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800">{pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}</GlobalSelect></label>}
    </div>
    <div className="flex items-center justify-between gap-3 sm:justify-end"><span aria-live="polite">Halaman {currentPage} dari {safeTotalPages}</span><div className="flex gap-2">
      <button type="button" aria-label="Halaman sebelumnya" disabled={loading || currentPage <= 1} onClick={() => onPageChange(Math.max(1, currentPage - 1))} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 font-semibold transition hover:border-blue-200 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"><ChevronLeft size={15} aria-hidden="true" /><span>Sebelumnya</span></button>
      <button type="button" aria-label="Halaman berikutnya" disabled={loading || currentPage >= safeTotalPages} onClick={() => onPageChange(Math.min(safeTotalPages, currentPage + 1))} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"><span>Berikutnya</span><ChevronRight size={15} aria-hidden="true" /></button>
    </div></div>
  </nav>;
}
