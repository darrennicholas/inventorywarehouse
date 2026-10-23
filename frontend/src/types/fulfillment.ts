export type FulfillmentStatus = "PICKING" | "PACKED" | "SHIPPED" | "COMPLETED" | "CANCELLED";

export type FulfillmentItem = {
  id: string;
  saleItemId: string;
  productId: string;
  quantity: number;
  pickedQuantity: number;
  packedQuantity: number;
  product?: { id: string; sku: string; barcode?: string | null; name: string };
};

export type FulfillmentRecord = {
  id: string;
  number: string;
  saleId: string;
  warehouseId: string;
  status: FulfillmentStatus;
  courier?: string | null;
  trackingNumber?: string | null;
  shippingAddress?: string | null;
  createdAt: string;
  sale?: { id: string; number: string; status: string; customer?: { name: string } | null };
  warehouse?: { id: string; code: string; name: string };
  items: FulfillmentItem[];
};

export type FulfillmentSale = {
  id: string;
  number: string;
  status: string;
  warehouseId: string;
  customer?: { name: string; address?: string | null } | null;
  warehouse?: { id: string; code: string; name: string };
  items: Array<{ id: string; productId: string; quantity: number; product: { id: string; sku: string; name: string } }>;
};
