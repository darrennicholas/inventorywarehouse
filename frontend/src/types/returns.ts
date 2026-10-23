
export type ReturnType = "PURCHASE" | "SALE";

export type ReturnStatus =
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "POSTED"
  | "CANCELLED";

export type ReturnCondition =
  | "GOOD"
  | "DAMAGED"
  | "EXPIRED"
  | "DEFECTIVE";

export type ReturnDisposition =
  | "RESTOCK"
  | "QUARANTINE"
  | "SCRAP";

export type LocationType =
  | "STORAGE"
  | "RECEIVING"
  | "QUARANTINE"
  | "DAMAGED";

export interface ReturnItem {
  id: string;
  productId: string;
  purchaseOrderItemId: string | null;
  saleItemId: string | null;
  locationId: string | null;
  batchId: string | null;
  quantity: number;
  condition: ReturnCondition;
  disposition: ReturnDisposition;
  notes: string | null;

  product?: {
    id: string;
    sku: string;
    name: string;
    trackBatch?: boolean;
  };

  location?: {
    id: string;
    code: string;
    name: string;
    locationType?: LocationType;
  };

  batch?: {
    id: string;
    batchNumber: string;
  } | null;
}

export interface ReturnRecord {
  id: string;
  number: string;
  type: ReturnType;
  status: ReturnStatus;

  purchaseOrderId: string | null;
  saleId: string | null;
  warehouseId: string;

  createdById: string;
  approvedById: string | null;

  reason: string;
  notes: string | null;

  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  postedAt: string | null;

  warehouse?: {
    id: string;
    name: string;
    code: string;
  };

  purchaseOrder?: {
    id: string;
    number: string;
    supplier?: {
      name: string;
    };
  } | null;

  sale?: {
    id: string;
    number: string;
    customer?: {
      name: string;
    } | null;
  } | null;

  createdBy?: {
    id: string;
    fullName: string;
  };

  approvedBy?: {
    id: string;
    fullName: string;
  } | null;

  items: ReturnItem[];
}

export interface ReturnsListResponse {
  success: boolean;
  data: ReturnRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ReturnDetailResponse {
  success: boolean;
  data: ReturnRecord;
  message?: string;
}

export type ReturnItemPayload = {
  productId: string;
  locationId: string;
  batchId: string | null;
  quantity: number;
  condition: ReturnCondition;
  disposition: ReturnDisposition;
  notes: string | null;
  purchaseOrderItemId?: string;
  saleItemId?: string;
};

export type CreateReturnPayload = {
  number: string;
  warehouseId: string;
  reason: string;
  notes: string | null;
  items: ReturnItemPayload[];
  purchaseOrderId?: string;
  saleId?: string;
};

export type ReturnListParams = {
  page?: number;
  pageSize?: number;
  status?: ReturnStatus;
  search?: string;
  warehouseId?: string;
};

export interface SourceItem {
  id: string;
  productId: string;
  quantity: number;
  receivedQuantity?: number;

  product?: {
    id: string;
    name: string;
    sku: string;
    trackBatch?: boolean;
  };
}

export interface SourceDocument {
  id: string;
  number: string;
  warehouseId: string;
  status: string;
  items: SourceItem[];

  supplier?: {
    name: string;
  };

  customer?: {
    name: string;
  } | null;
}

export type OptionRecord = {
  id: string;
  code?: string;
  name?: string;
  warehouseId?: string;
  productId?: string;
  batchNumber?: string;
  trackBatch?: boolean;
  locationType?: LocationType;

  product?: {
    name?: string;
    sku?: string;
  };
};

export interface ReturnOptions {
  warehouses: OptionRecord[];
  locations: OptionRecord[];
  batches: OptionRecord[];
  products: OptionRecord[];
}
