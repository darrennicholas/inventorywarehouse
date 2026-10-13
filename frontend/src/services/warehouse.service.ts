
import { apiDownload, apiRequest } from "@/lib/api";

import type {
  Warehouse,
  CreateWarehouseInput,
  UpdateWarehouseInput,
  WarehouseApiResponse,
} from "@/types/warehouse";

// ======================================
// EXTRACT DATA FROM API RESPONSE
// ======================================

function unwrap<T>(
  response: WarehouseApiResponse<T>
): T {
  if (
    !response.success ||
    response.data === undefined
  ) {
    throw new Error(
      response.message ?? "Warehouse API request failed"
    );
  }

  return response.data;
}

// ======================================
// WAREHOUSE SERVICE
// ======================================

export const warehouseService = {
  // GET ALL
  async getAll(
    signal?: AbortSignal
  ): Promise<Warehouse[]> {
    const response = await apiRequest<
      WarehouseApiResponse<Warehouse[]>
    >("/api/warehouses", { signal });

    return unwrap(response);
  },

  // GET DETAIL
  async getById(id: string): Promise<Warehouse> {
    const response = await apiRequest<
      WarehouseApiResponse<Warehouse>
    >(`/api/warehouses/${id}`);

    return unwrap(response);
  },

  // CREATE
  async create(
    input: CreateWarehouseInput
  ): Promise<Warehouse> {
    const response = await apiRequest<
      WarehouseApiResponse<Warehouse>
    >("/api/warehouses", {
      method: "POST",
      body: JSON.stringify(input),
    });

    return unwrap(response);
  },

  // UPDATE
  async update(
    id: string,
    input: UpdateWarehouseInput
  ): Promise<Warehouse> {
    const response = await apiRequest<
      WarehouseApiResponse<Warehouse>
    >(`/api/warehouses/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });

    return unwrap(response);
  },

  // SOFT DELETE
  async deactivate(
    id: string
  ): Promise<Warehouse> {
    const response = await apiRequest<
      WarehouseApiResponse<Warehouse>
    >(`/api/warehouses/${id}`, {
      method: "DELETE",
    });

    return unwrap(response);
  },

  async downloadStockCountSheet(warehouse: Warehouse): Promise<void> {
    const blob = await apiDownload(`/api/warehouses/${warehouse.id}/stock-count-sheet.pdf`);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `stock-count-${warehouse.code.toLowerCase()}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },
};
