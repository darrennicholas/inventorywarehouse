
import { apiRequest } from "@/lib/api";

import type {
  ApiResult,
  Staff,
  StaffInput,
  StaffWarehouse,
} from "@/types/staff";

// ======================================
// UNWRAP RESPONSE
// ======================================

function unwrap<T>(
  value: ApiResult<T>
): T {
  if (
    !value.success ||
    value.data === undefined
  ) {
    throw new Error(
      value.message ??
      "Unable to complete the request"
    );
  }

  return value.data;
}

// ======================================
// STAFF SERVICE
// ======================================

export const staffService = {
  // GET ALL STAFF
  async list(
    signal?: AbortSignal
  ): Promise<Staff[]> {
    const response = await apiRequest<
      ApiResult<Staff[]>
    >("/api/staff", { signal });

    return unwrap(response);
  },

  // GET STAFF DETAIL
  async detail(id: string): Promise<Staff> {
    const response = await apiRequest<
      ApiResult<Staff>
    >(`/api/staff/${id}`);

    return unwrap(response);
  },

  // CREATE STAFF
  async create(
    input: StaffInput
  ): Promise<Staff> {
    const response = await apiRequest<
      ApiResult<Staff>
    >("/api/staff", {
      method: "POST",
      body: JSON.stringify(input),
    });

    return unwrap(response);
  },

  // UPDATE STAFF
  async update(
    id: string,
    input: Partial<StaffInput>
  ): Promise<Staff> {
    const response = await apiRequest<
      ApiResult<Staff>
    >(`/api/staff/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });

    return unwrap(response);
  },

  // DEACTIVATE STAFF
  async deactivate(
    id: string
  ): Promise<Staff> {
    const response = await apiRequest<
      ApiResult<Staff>
    >(`/api/staff/${id}`, {
      method: "DELETE",
    });

    return unwrap(response);
  },

  // GET WAREHOUSE DROPDOWN OPTIONS
  async warehouseOptions(
    signal?: AbortSignal
  ): Promise<StaffWarehouse[]> {
    const response = await apiRequest<
      ApiResult<StaffWarehouse[]>
    >("/api/warehouses", { signal });

    return unwrap(response);
  },
};
