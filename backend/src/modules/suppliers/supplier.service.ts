
import { AppError } from "../../utils/AppError.ts";
import { supplierRepository } from "./supplier.repository.ts";

import type {
  CreateSupplierInput,
  UpdateSupplierInput,
} from "./supplier.validation.ts";

async function ensureUniqueCode(
  code: string,
  exceptId?: string
) {
  const existing = await supplierRepository.findByCode(code);

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
  list() {
    return supplierRepository.findAll();
  },

  async detail(id: string) {
    const supplier = await supplierRepository.findById(id);

    if (!supplier) {
      throw new AppError(
        404,
        "Supplier not found"
      );
    }

    return supplier;
  },

  async create(input: CreateSupplierInput) {
    await ensureUniqueCode(input.code);

    try {
      return await supplierRepository.create(input);
    } catch (error) {
      return handleDatabaseError(error);
    }
  },

  async update(
    id: string,
    input: UpdateSupplierInput
  ) {
    await supplierService.detail(id);

    if (input.code !== undefined) {
      await ensureUniqueCode(input.code, id);
    }

    try {
      return await supplierRepository.update(
        id,
        input
      );
    } catch (error) {
      return handleDatabaseError(error);
    }
  },

  deactivate(id: string) {
    return supplierService.update(id, {
      isActive: false,
    });
  },
};
