
import { AppError } from "../../utils/AppError.ts";
import { prisma } from "../../lib/prisma.ts";
import { productRepository, type ProductDbClient } from "./product.repository.ts";

import type {
  CreateProductInput,
  UpdateProductInput,
} from "./product.validation.ts";

// =====================================
// VERIFY CATEGORY / BRAND / UNIT
// =====================================

async function verifyReferences(
  data: UpdateProductInput,
  db: ProductDbClient,
) {
  const results =
    await productRepository.validateRelations(data, db);

  if (!results[0]) {
    throw new AppError(
      422,
      "Category does not exist"
    );
  }

  if (!results[1]) {
    throw new AppError(
      422,
      "Brand does not exist"
    );
  }

  if (!results[2]) {
    throw new AppError(
      422,
      "Unit does not exist"
    );
  }
}

// =====================================
// VERIFY UNIQUE SKU, CODE, BARCODE
// =====================================

async function verifyUnique(
  data: UpdateProductInput,
  exceptId?: string,
  db?: ProductDbClient,
) {
  if (data.sku) {
    const found =
      await productRepository.findBySku(data.sku, db);

    if (found && found.id !== exceptId) {
      throw new AppError(
        409,
        "SKU already exists"
      );
    }
  }

  if (data.code) {
    const found =
      await productRepository.findByCode(data.code, db);

    if (found && found.id !== exceptId) {
      throw new AppError(
        409,
        "Product code already exists"
      );
    }
  }

  if (data.barcode) {
    const found =
      await productRepository.findByBarcode(
        data.barcode,
        db,
      );

    if (found && found.id !== exceptId) {
      throw new AppError(
        409,
        "Barcode already exists"
      );
    }
  }

  // PostgreSQL unique constraints also protect
  // against concurrent requests.
}

// =====================================
// PRODUCT SERVICE
// =====================================

export const productService = {
  // GET ALL
  list(options?: { skip: number; take: number; search: string; isActive?: boolean }) {
    return productRepository.findAll(options);
  },
  count(options: { search: string; isActive?: boolean }) { return productRepository.count(options); },

  // GET MASTER OPTIONS
  options() {
    return productRepository.getOptions();
  },

  // GET DETAIL
  async detail(id: string, db?: ProductDbClient) {
    const product =
      await productRepository.findById(id, db);

    if (!product) {
      throw new AppError(
        404,
        "Product not found"
      );
    }

    return product;
  },

  // CREATE PRODUCT
  async create(input: CreateProductInput, db?: ProductDbClient) {
    const client = db ?? prisma;
    await verifyReferences(input, client);

    await verifyUnique(input, undefined, client);

    return productRepository.create(input, client);
  },

  // UPDATE PRODUCT
  async update(
    id: string,
    input: UpdateProductInput,
    db?: ProductDbClient,
  ) {
    const client = db ?? prisma;
    const current = await this.detail(id, client);

    // Prevent deactivating product with stock
    if (
      input.isActive === false &&
      typeof current.totalStock === "number" &&
      current.totalStock > 0
    ) {
      throw new AppError(
        409,
        "Cannot deactivate a product while stock remains"
      );
    }

    await verifyReferences(input, client);

    await verifyUnique(input, id, client);

    return productRepository.update(id, input, client);
  },

  // SOFT DELETE PRODUCT
  async deactivate(id: string, db?: ProductDbClient) {
    const client = db ?? prisma;
    const product = await this.detail(id, client);

    if (
      typeof product.totalStock === "number" &&
      product.totalStock > 0
    ) {
      throw new AppError(
        409,
        "Cannot deactivate a product while stock remains"
      );
    }

    return productRepository.update(id, {
      isActive: false,
    }, client);
  },
};
