
"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { warehouseService } from "@/services/warehouse.service";

import type {
  Warehouse,
  CreateWarehouseInput,
  UpdateWarehouseInput,
} from "@/types/warehouse";

export function useWarehouses() {
  const [warehouses, setWarehouses] =
    useState<Warehouse[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] =
    useState<string | null>(null);

  // ====================================
  // GET ALL WAREHOUSES
  // ====================================

  const fetchWarehouses = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);

      try {
        const data =
          await warehouseService.getAll(signal);

        if (!signal?.aborted) {
          setWarehouses(data);
        }
      } catch (err) {
        if (!signal?.aborted) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load warehouses"
          );
        }
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    []
  );

  // ====================================
  // FETCH ON PAGE LOAD
  // ====================================

  useEffect(() => {
    const controller = new AbortController();

    void Promise.resolve().then(() =>
      fetchWarehouses(controller.signal)
    );

    return () => controller.abort();
  }, [fetchWarehouses]);

  // ====================================
  // CREATE WAREHOUSE
  // ====================================

  const createWarehouse = useCallback(
    async (input: CreateWarehouseInput) => {
      setSaving(true);

      try {
        const created =
          await warehouseService.create(input);

        setWarehouses((previous) => [
          created,
          ...previous,
        ]);

        return created;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  // ====================================
  // UPDATE WAREHOUSE
  // ====================================

  const updateWarehouse = useCallback(
    async (
      id: string,
      input: UpdateWarehouseInput
    ) => {
      setSaving(true);

      try {
        const updated =
          await warehouseService.update(id, input);

        setWarehouses((previous) =>
          previous.map((warehouse) =>
            warehouse.id === id
              ? updated
              : warehouse
          )
        );

        return updated;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  // ====================================
  // SOFT DELETE WAREHOUSE
  // ====================================

  const deactivateWarehouse = useCallback(
    async (id: string) => {
      setSaving(true);

      try {
        const updated =
          await warehouseService.deactivate(id);

        setWarehouses((previous) =>
          previous.map((warehouse) =>
            warehouse.id === id
              ? updated
              : warehouse
          )
        );

        return updated;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return {
    warehouses,
    loading,
    saving,
    error,
    fetchWarehouses,
    createWarehouse,
    updateWarehouse,
    deactivateWarehouse,
  };
}
