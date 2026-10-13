
export interface Product {
  id: string;
  sku: string;
  name: string;

  code: string | null;
  barcode: string | null;
  description: string | null;
  imageUrl: string | null;

  categoryId: string | null;
  brandId: string | null;
  unitId: string | null;

  minStock: number;
  isActive: boolean;

  totalStock: number | null;

  category: {
    id: string;
    name: string;
  } | null;

  brand: {
    id: string;
    name: string;
  } | null;

  unit: {
    id: string;
    code: string;
    name: string;
  } | null;

  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  sku: string;
  name: string;

  code?: string | null;
  barcode?: string | null;
  description?: string | null;
  imageUrl?: string | null;

  categoryId?: string | null;
  brandId?: string | null;
  unitId?: string | null;

  minStock?: number;
  isActive?: boolean;
}

export interface ProductOptions {
  categories: {
    id: string;
    name: string;
    isActive: boolean;
  }[];

  brands: {
    id: string;
    name: string;
    isActive: boolean;
  }[];

  units: {
    id: string;
    code: string;
    name: string;
    isActive: boolean;
  }[];
}

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}
