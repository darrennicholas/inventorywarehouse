
import { apiRequest } from "@/lib/api";

import type {
  ApiResponse,
  MasterApi,
  MasterInput,
  MasterRecord,
  MasterUpdateInput,
} from "@/types/master";

function unwrap<T>(response: ApiResponse<T>): T {
  if (!response.success || response.data === undefined) {
    throw new Error(
      response.message ?? "API request failed"
    );
  }

  return response.data;
}

// ==========================================
// BRAND SERVICE
// ==========================================

export const brandService: MasterApi = {
  async list(signal?: AbortSignal) {
    const response = await apiRequest<
      ApiResponse<MasterRecord[]>
    >("/api/brands", { signal });

    return unwrap(response);
  },

  async create(input: MasterInput) {
    const response = await apiRequest<
      ApiResponse<MasterRecord>
    >("/api/brands", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        isActive: input.isActive,
      }),
    });

    return unwrap(response);
  },

  async update(
    id: string,
    input: MasterUpdateInput
  ) {
    const response = await apiRequest<
      ApiResponse<MasterRecord>
    >(`/api/brands/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: input.name,
        isActive: input.isActive,
      }),
    });

    return unwrap(response);
  },

  async deactivate(id: string) {
    const response = await apiRequest<
      ApiResponse<MasterRecord>
    >(`/api/brands/${id}`, {
      method: "DELETE",
    });

    return unwrap(response);
  },
};

// ==========================================
// UNIT SERVICE
// ==========================================

export const unitService: MasterApi = {
  async list(signal?: AbortSignal) {
    const response = await apiRequest<
      ApiResponse<MasterRecord[]>
    >("/api/units", { signal });

    return unwrap(response);
  },

  async create(input: MasterInput) {
    const response = await apiRequest<
      ApiResponse<MasterRecord>
    >("/api/units", {
      method: "POST",
      body: JSON.stringify({
        code: input.code ?? "",
        name: input.name,
        isActive: input.isActive,
      }),
    });

    return unwrap(response);
  },

  async update(
    id: string,
    input: MasterUpdateInput
  ) {
    const response = await apiRequest<
      ApiResponse<MasterRecord>
    >(`/api/units/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        code: input.code,
        name: input.name,
        isActive: input.isActive,
      }),
    });

    return unwrap(response);
  },

  async deactivate(id: string) {
    const response = await apiRequest<
      ApiResponse<MasterRecord>
    >(`/api/units/${id}`, {
      method: "DELETE",
    });

    return unwrap(response);
  },
};
