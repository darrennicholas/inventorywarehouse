"use client";

import { useCallback, useEffect, useState } from "react";

import { customerService } from "@/services/customer.service";
import type {
  CreateCustomerInput,
  Customer,
  UpdateCustomerInput,
} from "@/types/customer";

export function useCustomers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCustomers = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);

    try {
      const data = await customerService.getAll(signal);
      if (!signal?.aborted) setCustomers(data);
    } catch (err) {
      if (!signal?.aborted) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to retrieve customers"
        );
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() =>
      fetchCustomers(controller.signal)
    );
    return () => controller.abort();
  }, [fetchCustomers]);

  const createCustomer = useCallback(
    async (data: CreateCustomerInput) => {
      setSaving(true);
      try {
        const created = await customerService.create(data);
        setCustomers((previous) => [created, ...previous]);
        return created;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  const updateCustomer = useCallback(async (id: string, data: UpdateCustomerInput) => {
    setSaving(true);
    try {
      const updated = await customerService.update(id, data);
      setCustomers((previous) => previous.map((customer) => customer.id === id ? updated : customer));
      return updated;
    } finally { setSaving(false); }
  }, []);

  const deactivateCustomer = useCallback(async (id: string) => {
    setSaving(true);
    try {
      const updated = await customerService.deactivate(id);
      setCustomers((previous) => previous.map((customer) => customer.id === id ? updated : customer));
      return updated;
    } finally { setSaving(false); }
  }, []);

  return {
    customers,
    loading,
    saving,
    error,
    fetchCustomers,
    createCustomer,
    updateCustomer,
    deactivateCustomer,
  };
}
