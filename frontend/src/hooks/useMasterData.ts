
"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import type {
  MasterApi,
  MasterInput,
  MasterRecord,
  MasterUpdateInput,
} from "@/types/master";

export function useMasterData(api: MasterApi) {
  const [rows, setRows] = useState<MasterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GET ALL
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);

      try {
        const data = await api.list(signal);

        if (!signal?.aborted) {
          setRows(data);
        }
      } catch (err) {
        if (!signal?.aborted) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to retrieve data"
          );
        }
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [api]
  );

  useEffect(() => {
    const controller = new AbortController();

    void Promise.resolve().then(() =>
      refresh(controller.signal)
    );

    return () => controller.abort();
  }, [refresh]);

  // CREATE
  const create = useCallback(
    async (input: MasterInput) => {
      setSaving(true);

      try {
        const created = await api.create(input);

        setRows(previous => [
          created,
          ...previous,
        ]);

        return created;
      } finally {
        setSaving(false);
      }
    },
    [api]
  );

  // UPDATE
  const update = useCallback(
    async (
      id: string,
      input: MasterUpdateInput
    ) => {
      setSaving(true);

      try {
        const updated = await api.update(id, input);

        setRows(previous =>
          previous.map(row =>
            row.id === id ? updated : row
          )
        );

        return updated;
      } finally {
        setSaving(false);
      }
    },
    [api]
  );

  // SOFT DELETE
  const deactivate = useCallback(
    async (id: string) => {
      setSaving(true);

      try {
        const updated = await api.deactivate(id);

        setRows(previous =>
          previous.map(row =>
            row.id === id ? updated : row
          )
        );

        return updated;
      } finally {
        setSaving(false);
      }
    },
    [api]
  );

  return {
    rows,
    loading,
    saving,
    error,
    refresh,
    create,
    update,
    deactivate,
  };
}
