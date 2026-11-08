"use client";
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { apiRequest } from "@/lib/api";
import { hasActionIntent } from "@/lib/action-intent";

type PageResult<T> = { data: T[]; meta: { total: number } };
export function usePagedMaster<T>(endpoint: string, page: number, pageSize: number, search: string, status: string, saving: boolean, setPage: Dispatch<SetStateAction<number>>) {
  const [rows, setRows] = useState<T[]>([]); const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), search: search.trim() });
      if (status !== "all") query.set("isActive", String(status === "active"));
      const result = await apiRequest<PageResult<T>>(`${endpoint}?${query}`, { signal });
      if (!signal?.aborted) { setRows(result.data); setTotal(result.meta.total); const last = Math.max(1, Math.ceil(result.meta.total / pageSize)); if (page > last) setPage(last); }
    } catch (reason) { if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Data tidak dapat dimuat."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [endpoint, page, pageSize, search, status, setPage]);
  useEffect(() => { if (saving) return; const controller = new AbortController(); const timer = window.setTimeout(() => void reload(controller.signal), hasActionIntent() ? 0 : 250); return () => { window.clearTimeout(timer); controller.abort(); }; }, [reload, saving]);
  return { rows, total, loading, error, reload };
}
