
"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { categoryService } from "@/services/category.service";

import type {
  Category,
  CreateCategoryInput,
  UpdateCategoryInput,
} from "@/types/category";

export function useCategories() {
  const [categories, setCategories] =
    useState<Category[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ==========================================
  // FETCH CATEGORIES
  // ==========================================

  const fetchCategories = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);

      try {
        const data = await categoryService.getAll(signal);

        if (!signal?.aborted) {
          setCategories(data);
        }
      } catch (err) {
        if (!signal?.aborted) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to retrieve categories"
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
      fetchCategories(controller.signal)
    );

    return () => {
      controller.abort();
    };
  }, [fetchCategories]);

  // ==========================================
  // CREATE CATEGORY
  // ==========================================

  const createCategory = useCallback(
    async (data: CreateCategoryInput) => {
      setSaving(true);

      try {
        const created = await categoryService.create(data);

        setCategories((previous) => [
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

  // ==========================================
  // UPDATE CATEGORY
  // ==========================================

  const updateCategory = useCallback(
    async (
      id: string,
      data: UpdateCategoryInput
    ) => {
      setSaving(true);

      try {
        const updated = await categoryService.update(id, data);

        setCategories((previous) =>
          previous.map((category) =>
            category.id === id ? updated : category
          )
        );

        return updated;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  const deactivateCategory = useCallback(async (id: string) => {
    setSaving(true);
    try {
      const updated = await categoryService.deactivate(id);
      setCategories((previous) => previous.map((category) =>
        category.id === id ? updated : category
      ));
      return updated;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    categories,
    loading,
    saving,
    error,
    fetchCategories,
    createCategory,
    updateCategory,
    deactivateCategory,
  };
}
