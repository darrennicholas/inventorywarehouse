export interface Customer {
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

export interface CreateCustomerInput {
  code: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  isActive?: boolean;
}

export type UpdateCustomerInput = Partial<CreateCustomerInput>;

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}
