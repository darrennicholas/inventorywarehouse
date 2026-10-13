
export interface Warehouse {
  id: string;
  code: string;
  name: string;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWarehouseInput {
  code: string;
  name: string;
  address?: string | null;
  isActive?: boolean;
}

export interface UpdateWarehouseInput {
  code?: string;
  name?: string;
  address?: string | null;
  isActive?: boolean;
}

export interface WarehouseApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}
