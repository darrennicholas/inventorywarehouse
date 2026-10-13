
import { apiRequest } from "@/lib/api";

import type {
  ApiResponse,
  Product,
  ProductInput,
  ProductOptions,
} from "@/types/product";

// Extract data from API response
function unwrap<T>(response: ApiResponse<T>): T {
  if (
    !response.success ||
    response.data === undefined
  ) {
    throw new Error(
      response.message ?? "API request failed"
    );
  }

  return response.data;
}

export const productService = {
  // =====================================
  // GET ALL PRODUCTS
  // =====================================
  async getAll(
    signal?: AbortSignal
  ): Promise<Product[]> {
    const response = await apiRequest<
      ApiResponse<Product[]>
    >("/api/products", { signal });

    return unwrap(response);
  },

  // =====================================
  // GET PRODUCT DETAIL
  // =====================================
  async getById(id: string): Promise<Product> {
    const response = await apiRequest<
      ApiResponse<Product>
    >(`/api/products/${id}`);

    return unwrap(response);
  },

  // =====================================
  // GET CATEGORY / BRAND / UNIT OPTIONS
  // =====================================
  async getOptions(): Promise<ProductOptions> {
    const response = await apiRequest<
      ApiResponse<ProductOptions>
    >("/api/products/options");

    return unwrap(response);
  },

  // =====================================
  // CREATE PRODUCT
  // =====================================
  async create(input: ProductInput): Promise<Product> {
    const response = await apiRequest<
      ApiResponse<Product>
    >("/api/products", {
      method: "POST",
      body: JSON.stringify(input),
    });

    return unwrap(response);
  },

  // =====================================
  // UPDATE PRODUCT
  // =====================================
  async update(
    id: string,
    input: Partial<ProductInput>
  ): Promise<Product> {
    const response = await apiRequest<
      ApiResponse<Product>
    >(`/api/products/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });

    return unwrap(response);
  },

  // =====================================
  // SOFT DELETE PRODUCT
  // =====================================
  async deactivate(id: string): Promise<Product> {
    const response = await apiRequest<
      ApiResponse<Product>
    >(`/api/products/${id}`, {
      method: "DELETE",
    });

    return unwrap(response);
  },
};
