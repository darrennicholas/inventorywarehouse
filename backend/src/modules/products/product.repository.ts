
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
  async findAll(options?: { skip: number; take: number; search: string; isActive?: boolean }) {
    const products = await prisma.product.findMany({
      include: withRelations,
      ...(options ? { skip: options.skip, take: options.take, where: { ...(options.isActive !== undefined ? { isActive: options.isActive } : {}), ...(options.search ? { OR: [{ sku: { contains: options.search, mode: "insensitive" as const } }, { name: { contains: options.search, mode: "insensitive" as const } }, { code: { contains: options.search, mode: "insensitive" as const } }, { barcode: { contains: options.search, mode: "insensitive" as const } }, { category: { name: { contains: options.search, mode: "insensitive" as const } } }, { brand: { name: { contains: options.search, mode: "insensitive" as const } } }] } : {}) } } : {}),

      orderBy: {
        createdAt: "desc",
      },
    });

    return products.map(serializeProduct);
  },

  count(options: { search: string; isActive?: boolean }) {
    return prisma.product.count({ where: { ...(options.isActive !== undefined ? { isActive: options.isActive } : {}), ...(options.search ? { OR: [{ sku: { contains: options.search, mode: "insensitive" } }, { name: { contains: options.search, mode: "insensitive" } }, { code: { contains: options.search, mode: "insensitive" } }, { barcode: { contains: options.search, mode: "insensitive" } }, { category: { name: { contains: options.search, mode: "insensitive" } } }, { brand: { name: { contains: options.search, mode: "insensitive" } } }] } : {}) } });
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
