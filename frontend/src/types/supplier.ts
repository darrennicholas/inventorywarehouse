
export interface Supplier {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierInput {
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
}

export type UpdateSupplierInput = Partial<SupplierInput>;

export interface SupplierApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}
