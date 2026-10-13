
"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { supplierService } from "@/services/supplier.service";

import type {
  Supplier,
  SupplierInput,
  UpdateSupplierInput,
} from "@/types/supplier";

export function useSuppliers() {
  const [suppliers, setSuppliers] =
    useState<Supplier[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);

      try {
        const data = await supplierService.list(signal);

        if (!signal?.aborted) {
          setSuppliers(data);
        }
      } catch (reason) {
        if (!signal?.aborted) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Failed to load suppliers"
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

  useEffect(() => {
    const controller = new AbortController();

    void Promise.resolve().then(() =>
      refresh(controller.signal)
    );

    return () => controller.abort();
  }, [refresh]);

  const create = useCallback(
    async (input: SupplierInput) => {
      setSaving(true);

      try {
        const created =
          await supplierService.create(input);

        setSuppliers((current) => [
          created,
          ...current,
        ]);

        return created;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  const update = useCallback(
    async (
      id: string,
      input: UpdateSupplierInput
    ) => {
      setSaving(true);

      try {
        const updated =
          await supplierService.update(id, input);

        setSuppliers((current) =>
          current.map((item) =>
            item.id === id ? updated : item
          )
        );

        return updated;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  const deactivate = useCallback(
    async (id: string) => {
      setSaving(true);

      try {
        const updated =
          await supplierService.deactivate(id);

        setSuppliers((current) =>
          current.map((item) =>
            item.id === id ? updated : item
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
    suppliers,
    loading,
    saving,
    error,
    refresh,
    create,
    update,
    deactivate,
  };
}
