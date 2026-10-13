
"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { productService } from "@/services/product.service";

import type {
  Product,
  ProductInput,
} from "@/types/product";

export function useProducts(enabled = true) {
  const [products, setProducts] =
    useState<Product[]>([]);

  const [loading, setLoading] = useState(enabled);

  const [saving, setSaving] = useState(false);

  const [error, setError] =
    useState<string | null>(null);

  // =====================================
  // FETCH PRODUCTS
  // =====================================
  const fetchProducts = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);

      try {
        const data =
          await productService.getAll(signal);

        if (!signal?.aborted) {
          setProducts(data);
        }
      } catch (error) {
        if (!signal?.aborted) {
          setError(
            error instanceof Error
              ? error.message
              : "Cannot load products"
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
    if (!enabled) {
      void Promise.resolve().then(() => setLoading(false));
      return;
    }

    const controller = new AbortController();

    void Promise.resolve().then(() =>
      fetchProducts(controller.signal)
    );

    return () => {
      controller.abort();
    };
  }, [enabled, fetchProducts]);

  // =====================================
  // CREATE PRODUCT
  // =====================================
  const createProduct = useCallback(
    async (input: ProductInput) => {
      setSaving(true);

      try {
        const created =
          await productService.create(input);

        setProducts((previous) => [
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

  // =====================================
  // UPDATE PRODUCT
  // =====================================
  const updateProduct = useCallback(
    async (
      id: string,
      input: Partial<ProductInput>
    ) => {
      setSaving(true);

      try {
        const updated =
          await productService.update(id, input);

        setProducts((previous) =>
          previous.map((product) =>
            product.id === id
              ? updated
              : product
          )
        );

        return updated;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  // =====================================
  // DEACTIVATE PRODUCT
  // =====================================
  const deactivateProduct = useCallback(
    async (id: string) => {
      setSaving(true);

      try {
        const updated =
          await productService.deactivate(id);

        setProducts((previous) =>
          previous.map((product) =>
            product.id === id
              ? updated
              : product
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
    products,
    loading,
    saving,
    error,
    fetchProducts,
    createProduct,
    updateProduct,
    deactivateProduct,
  };
}

export type ProductStore = ReturnType<
  typeof useProducts
>;
