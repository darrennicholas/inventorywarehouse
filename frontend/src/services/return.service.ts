
import { apiRequest } from "@/lib/api";

import type {
  CreateReturnPayload,
  ReturnDetailResponse,
  ReturnListParams,
  ReturnRecord,
  ReturnsListResponse,
  ReturnType,
  SourceDocument,
  ReturnOptions,
} from "@/types/returns";

const base = "/api/returns";

export const returnService = {
  list(type: ReturnType, params: ReturnListParams = {}) {
    const q = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") {
        q.set(key, String(value));
      }
    }

    return apiRequest<ReturnsListResponse>(
      `${base}/${type === "PURCHASE" ? "purchase" : "sales"}?${q}`
    );
  },

  get(id: string) {
    return apiRequest<ReturnDetailResponse>(
      `${base}/${id}`
    );
  },

  create(type: ReturnType, payload: CreateReturnPayload) {
    return apiRequest<ReturnDetailResponse>(
      `${base}/${type === "PURCHASE" ? "purchase" : "sales"}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },

  update(
    id: string,
    data: {
      reason?: string;
      notes?: string | null;
    }
  ) {
    return apiRequest<ReturnDetailResponse>(
      `${base}/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      }
    );
  },

  act(
    id: string,
    action: "submit" | "approve" | "post"
  ) {
    return apiRequest<ReturnDetailResponse>(
      `${base}/${id}/${action}`,
      {
        method: "POST",
      }
    );
  },

  cancel(id: string) {
    return apiRequest<ReturnDetailResponse>(
      `${base}/${id}`,
      {
        method: "DELETE",
      }
    );
  },

  async options(): Promise<ReturnOptions> {
    const result = await apiRequest<{
      success: boolean;
      data: Partial<ReturnOptions>;
    }>("/api/operations/options");

    return {
      warehouses: result.data.warehouses ?? [],
      locations: result.data.locations ?? [],
      batches: result.data.batches ?? [],
      products: result.data.products ?? [],
    };
  },

  async sources(
    type: ReturnType
  ): Promise<SourceDocument[]> {
    const endpoint =
      type === "PURCHASE"
        ? "/api/operations/purchases"
        : "/api/operations/sales";

    const result = await apiRequest<{
      success: boolean;
      data: SourceDocument[];
    }>(`${endpoint}?page=1&pageSize=100`);

    return (result.data ?? []).filter((x) =>
      type === "PURCHASE"
        ? ["RECEIVED", "PARTIALLY_RECEIVED"].includes(
            x.status
          )
        : x.status === "COMPLETED"
    );
  },
};

export type { ReturnRecord };
