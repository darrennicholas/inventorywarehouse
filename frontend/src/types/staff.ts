
export type StaffWarehouse = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

export type Staff = {
  id: string;
  staffCode: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  position: string | null;

  warehouseId: string | null;
  warehouse: StaffWarehouse | null;

  isActive: boolean;

  createdAt: string;
  updatedAt: string;
};

export type StaffInput = {
  staffCode: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  warehouseId: string | null;
  isActive: boolean;
};

export type ApiResult<T> = {
  success: boolean;
  message?: string;
  data?: T;
};
