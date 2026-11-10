
import { AppError } from "../../utils/AppError.ts";
import { supplierRepository, type SupplierDbClient } from "./supplier.repository.ts";

import type {
  CreateSupplierInput,
  UpdateSupplierInput,
} from "./supplier.validation.ts";

async function ensureUniqueCode(
  code: string,
  exceptId?: string,
  db?: SupplierDbClient,
) {
  const existing = await supplierRepository.findByCode(code, db);

  if (existing && existing.id !== exceptId) {
    throw new AppError(
      409,
      "Supplier code already exists"
    );
  }
}

function handleDatabaseError(error: unknown): never {
  if (
    error &&
    typeof error === "object" &&
    "code" in error
  ) {
    const code = (
      error as { code?: unknown }
    ).code;

    if (code === "P2002") {
      throw new AppError(
        409,
        "Supplier code already exists"
      );
    }

    if (code === "P2025") {
      throw new AppError(
        404,
        "Supplier not found"
      );
    }
  }

  throw error;
}

export const supplierService = {
  list(options?: { skip?: number; take?: number; search?: string; isActive?: boolean }) {
    return supplierRepository.findAll(options);
  },
  count(options?: { search?: string; isActive?: boolean }) {
    return supplierRepository.count(options);
  },

  async detail(id: string, db?: SupplierDbClient) {
    const supplier = await supplierRepository.findById(id, db);

    if (!supplier) {
      throw new AppError(
        404,
        "Supplier not found"
      );
    }

    return supplier;
  },

  async create(input: CreateSupplierInput, db?: SupplierDbClient) {
    const client = db;
    await ensureUniqueCode(input.code, undefined, client);

    try {
      return await supplierRepository.create(input, client);
    } catch (error) {
      return handleDatabaseError(error);
    }
  },

  async update(
    id: string,
    input: UpdateSupplierInput,
    db?: SupplierDbClient,
  ) {
    await supplierService.detail(id, db);

    if (input.code !== undefined) {
      await ensureUniqueCode(input.code, id, db);
    }

    try {
      return await supplierRepository.update(
        id,
        input,
        db,
      );
    } catch (error) {
      return handleDatabaseError(error);
    }
  },

  deactivate(id: string, db?: SupplierDbClient) {
    return supplierService.update(id, {
      isActive: false,
    }, db);
  },
};
