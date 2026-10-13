import { apiRequest } from "@/lib/api";

import type {
  ApiResponse,
  CreateCustomerInput,
  Customer,
  UpdateCustomerInput,
} from "@/types/customer";

export const customerService = {
  async getAll(signal?: AbortSignal): Promise<Customer[]> {
    const response = await apiRequest<ApiResponse<Customer[]>>(
      "/api/customers",
      { signal }
    );

    if (!response.success || !Array.isArray(response.data)) {
      throw new Error(
        response.message ?? "Failed to retrieve customers"
      );
    }

    return response.data;
  },

  async create(data: CreateCustomerInput): Promise<Customer> {
    const response = await apiRequest<ApiResponse<Customer>>(
      "/api/customers",
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );

    if (!response.success || !response.data) {
      throw new Error(
        response.message ?? "Failed to create customer"
      );
    }

    return response.data;
  },

  async update(id: string, data: UpdateCustomerInput): Promise<Customer> {
    const response = await apiRequest<ApiResponse<Customer>>(`/api/customers/${id}`, { method: "PATCH", body: JSON.stringify(data) });
    if (!response.success || !response.data) throw new Error(response.message ?? "Failed to update customer");
    return response.data;
  },

  async deactivate(id: string): Promise<Customer> {
    const response = await apiRequest<ApiResponse<Customer>>(`/api/customers/${id}`, { method: "DELETE" });
    if (!response.success || !response.data) throw new Error(response.message ?? "Failed to deactivate customer");
    return response.data;
  },

  async importRows(rows: CreateCustomerInput[]): Promise<{ imported: number; skipped: number }> {
    const response = await apiRequest<ApiResponse<{ imported: number; skipped: number }>>("/api/customers/import", { method: "POST", body: JSON.stringify({ rows }) });
    if (!response.success || !response.data) throw new Error(response.message ?? "Failed to import customers");
    return response.data;
  },
};
