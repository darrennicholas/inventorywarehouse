"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";

export function useApiQuery<T>(endpoint: string, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      const response = await apiRequest<{ success: boolean; data: T }>(endpoint, { signal });
      if (!signal?.aborted) setData(response.data);
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Request failed");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [endpoint]);
  useEffect(() => { if (!enabled) return; const controller = new AbortController(); void Promise.resolve().then(() => reload(controller.signal)); return () => controller.abort(); }, [enabled, reload]);
  return { data, loading, error, reload };
}
