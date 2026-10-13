
import { apiRequest } from "@/lib/api";

import type {
  Category,
  CreateCategoryInput,
  UpdateCategoryInput,
  ApiResponse,
} from "@/types/category";

export const categoryService = {
  // GET ALL CATEGORIES
  async getAll(signal?: AbortSignal): Promise<Category[]> {
    const response = await apiRequest<
      ApiResponse<Category[]>
    >("/api/categories", { signal });

    if (!response.success || !Array.isArray(response.data)) {
      throw new Error(
        response.message ?? "Failed to retrieve categories"
      );
    }

    return response.data;
  },

  // GET CATEGORY BY ID
  async getById(id: string): Promise<Category> {
    const response = await apiRequest<
      ApiResponse<Category>
    >(`/api/categories/${id}`);

    if (!response.success || !response.data) {
      throw new Error(
        response.message ?? "Category not found"
      );
    }

    return response.data;
  },

  // CREATE CATEGORY
  async create(
    data: CreateCategoryInput
  ): Promise<Category> {
    const response = await apiRequest<
      ApiResponse<Category>
    >("/api/categories", {
      method: "POST",
      body: JSON.stringify(data),
    });

    if (!response.success || !response.data) {
      throw new Error(
        response.message ?? "Failed to create category"
      );
    }

    return response.data;
  },

  // UPDATE CATEGORY
  async update(
    id: string,
    data: UpdateCategoryInput
  ): Promise<Category> {
    const response = await apiRequest<
      ApiResponse<Category>
    >(`/api/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });

    if (!response.success || !response.data) {
      throw new Error(
        response.message ?? "Failed to update category"
      );
    }

    return response.data;
  },

  async deactivate(id: string): Promise<Category> {
    const response = await apiRequest<ApiResponse<Category>>(
      `/api/categories/${id}`,
      { method: "DELETE" }
    );

    if (!response.success || !response.data) {
      throw new Error(response.message ?? "Failed to deactivate category");
    }

    return response.data;
  },
};
