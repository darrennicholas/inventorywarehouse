
import { apiRequest } from "@/lib/api";

import type {
  Supplier,
  SupplierApiResponse,
  SupplierInput,
  UpdateSupplierInput,
} from "@/types/supplier";

function unwrap<T>(result: SupplierApiResponse<T>): T {
  if (!result.success || result.data === undefined) {
    throw new Error(
      result.message ?? "Supplier API request failed"
    );
  }

  return result.data;
}

export const supplierService = {
  async list(signal?: AbortSignal): Promise<Supplier[]> {
    const response = await apiRequest<
      SupplierApiResponse<Supplier[]>
    >("/api/suppliers", { signal });

    return unwrap(response);
  },

  async detail(id: string): Promise<Supplier> {
    const response = await apiRequest<
      SupplierApiResponse<Supplier>
    >(`/api/suppliers/${id}`);

    return unwrap(response);
  },

  async create(input: SupplierInput): Promise<Supplier> {
    const response = await apiRequest<
      SupplierApiResponse<Supplier>
    >("/api/suppliers", {
      method: "POST",
      body: JSON.stringify(input),
    });

    return unwrap(response);
  },

  async update(
    id: string,
    input: UpdateSupplierInput
  ): Promise<Supplier> {
    const response = await apiRequest<
      SupplierApiResponse<Supplier>
    >(`/api/suppliers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });

    return unwrap(response);
  },

  async deactivate(id: string): Promise<Supplier> {
    const response = await apiRequest<
      SupplierApiResponse<Supplier>
    >(`/api/suppliers/${id}`, {
      method: "DELETE",
    });

    return unwrap(response);
  },
};
