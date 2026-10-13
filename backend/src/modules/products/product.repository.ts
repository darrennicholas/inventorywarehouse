
import { prisma } from "../../lib/prisma.ts";

import type {
  CreateProductInput,
  UpdateProductInput,
} from "./product.validation.ts";

// Include relations when retrieving products
const withRelations = {
  category: {
    select: {
      id: true,
      name: true,
    },
  },

  brand: {
    select: {
      id: true,
      name: true,
    },
  },

  unit: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },

  inventoryBalances: {
    select: {
      quantityOnHand: true,
    },
  },
} as const;

// Convert inventory balances to total stock
function serializeProduct<
  T extends {
    inventoryBalances: {
      quantityOnHand: number;
    }[];
  }
>(product: T) {
  const { inventoryBalances, ...data } = product;

  return {
    ...data,

    // null means no stock balance has been recorded yet
    totalStock: inventoryBalances.length
      ? inventoryBalances.reduce(
          (sum, item) => sum + item.quantityOnHand,
          0
        )
      : null,
  };
}

export const productRepository = {
  // =====================================
  // GET ALL PRODUCTS
  // =====================================
  async findAll() {
    const products = await prisma.product.findMany({
      include: withRelations,

      orderBy: {
        createdAt: "desc",
      },
    });

    return products.map(serializeProduct);
  },

  // =====================================
  // GET PRODUCT BY ID
  // =====================================
  async findById(id: string) {
    const product = await prisma.product.findUnique({
      where: {
        id,
      },

      include: withRelations,
    });

    return product ? serializeProduct(product) : null;
  },

  // =====================================
  // FIND BY SKU
  // =====================================
  findBySku(sku: string) {
    return prisma.product.findUnique({
      where: {
        sku,
      },
    });
  },

  // =====================================
  // FIND BY CODE
  // =====================================
  findByCode(code: string) {
    return prisma.product.findUnique({
      where: {
        code,
      },
    });
  },

  // =====================================
  // FIND BY BARCODE
  // =====================================
  findByBarcode(barcode: string) {
    return prisma.product.findUnique({
      where: {
        barcode,
      },
    });
  },

  // =====================================
  // CREATE PRODUCT
  // =====================================
  async create(data: CreateProductInput) {
    const product = await prisma.product.create({
      data,

      include: withRelations,
    });

    return serializeProduct(product);
  },

  // =====================================
  // UPDATE PRODUCT
  // =====================================
  async update(
    id: string,
    data: UpdateProductInput
  ) {
    const product = await prisma.product.update({
      where: {
        id,
      },

      data,

      include: withRelations,
    });

    return serializeProduct(product);
  },

  // =====================================
  // GET CATEGORY, BRAND, UNIT OPTIONS
  // =====================================
  getOptions() {
    return Promise.all([
      prisma.category.findMany({
        select: {
          id: true,
          name: true,
          isActive: true,
        },

        orderBy: {
          name: "asc",
        },
      }),

      prisma.brand.findMany({
        select: {
          id: true,
          name: true,
          isActive: true,
        },

        orderBy: {
          name: "asc",
        },
      }),

      prisma.unit.findMany({
        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
        },

        orderBy: {
          code: "asc",
        },
      }),
    ]).then(([categories, brands, units]) => ({
      categories,
      brands,
      units,
    }));
  },

  // =====================================
  // VALIDATE FOREIGN KEY RELATIONS
  // =====================================
  async validateRelations(input: UpdateProductInput) {
    const checks = [
      input.categoryId
        ? prisma.category.findUnique({
            where: {
              id: input.categoryId,
            },
            select: {
              id: true,
              isActive: true,
            },
          })
        : Promise.resolve(true),

      input.brandId
        ? prisma.brand.findUnique({
            where: {
              id: input.brandId,
            },
            select: {
              id: true,
              isActive: true,
            },
          })
        : Promise.resolve(true),

      input.unitId
        ? prisma.unit.findUnique({
            where: {
              id: input.unitId,
            },
            select: {
              id: true,
              isActive: true,
            },
          })
        : Promise.resolve(true),
    ];

    return Promise.all(checks);
  },
};
