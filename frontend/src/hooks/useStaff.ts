
"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { staffService } from "@/services/staff.service";

import type {
  Staff,
  StaffInput,
} from "@/types/staff";

// ======================================
// STAFF HOOK
// ======================================

export function useStaff() {
  const [staff, setStaff] =
    useState<Staff[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  // ====================================
  // FETCH STAFF
  // ====================================

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);

      try {
        const data =
          await staffService.list(signal);

        if (!signal?.aborted) {
          setStaff(data);
        }
      } catch (reason) {
        if (!signal?.aborted) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Failed to load staff"
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
  // FETCH ON COMPONENT MOUNT
  // ====================================

  useEffect(() => {
    const controller =
      new AbortController();

    void Promise.resolve().then(() =>
      refresh(controller.signal)
    );

    return () => controller.abort();
  }, [refresh]);

  // ====================================
  // CREATE STAFF
  // ====================================

  const create = useCallback(
    async (input: StaffInput) => {
      setSaving(true);

      try {
        const created =
          await staffService.create(input);

        setStaff((previous) => [
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
  // UPDATE STAFF
  // ====================================

  const update = useCallback(
    async (
      id: string,
      input: Partial<StaffInput>
    ) => {
      setSaving(true);

      try {
        const updated =
          await staffService.update(id, input);

        setStaff((previous) =>
          previous.map((item) =>
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

  // ====================================
  // DEACTIVATE STAFF
  // ====================================

  const deactivate = useCallback(
    async (id: string) => {
      setSaving(true);

      try {
        const updated =
          await staffService.deactivate(id);

        setStaff((previous) =>
          previous.map((item) =>
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
    staff,
    loading,
    saving,
    error,
    refresh,
    create,
    update,
    deactivate,
  };
}
