import { apiRequest } from "@/lib/api";
import type { FulfillmentRecord, FulfillmentSale, FulfillmentStatus } from "@/types/fulfillment";

type ListResponse = { success: boolean; data: FulfillmentRecord[]; total: number; page: number; pageSize: number };

export const fulfillmentService = {
  list(params: { status?: FulfillmentStatus; search?: string; page?: number } = {}) {
    const query = new URLSearchParams();
    if (params.status) query.set("status", params.status);
    if (params.search) query.set("search", params.search);
    query.set("page", String(params.page ?? 1));
    query.set("pageSize", "20");
    return apiRequest<ListResponse>(`/api/fulfillment?${query.toString()}`);
  },

  sales() {
    return apiRequest<{ success: boolean; data: FulfillmentSale[] }>("/api/fulfillment/sales");
  },

  createShipment(saleId: string, payload: { shippingAddress?: string | null; items: Array<{ saleItemId: string; quantity: number }> }) {
    return apiRequest<{ success: boolean; data: FulfillmentRecord }>(`/api/fulfillment/sales/${saleId}/shipments`, { method: "POST", body: JSON.stringify(payload) });
  },

  pick(id: string, items?: Array<{ shipmentItemId: string; quantity: number }>) {
    return apiRequest<{ success: boolean; data: FulfillmentRecord }>(`/api/fulfillment/${id}/pick`, { method: "POST", body: JSON.stringify(items?.length ? { items } : {}) });
  },

  pack(id: string) {
    return apiRequest<{ success: boolean; data: FulfillmentRecord }>(`/api/fulfillment/${id}/pack`, { method: "POST", body: JSON.stringify({}) });
  },

  ship(id: string, payload: { courier: string; trackingNumber: string; shippingAddress?: string | null }) {
    return apiRequest<{ success: boolean; data: FulfillmentRecord }>(`/api/fulfillment/${id}/ship`, { method: "POST", body: JSON.stringify(payload) });
  },

  complete(id: string) {
    return apiRequest<{ success: boolean; data: FulfillmentRecord }>(`/api/fulfillment/${id}/complete`, { method: "POST", body: JSON.stringify({}) });
  },

  cancel(id: string) {
    return apiRequest<{ success: boolean; data: FulfillmentRecord }>(`/api/fulfillment/${id}/cancel`, { method: "POST", body: JSON.stringify({}) });
  },
};
