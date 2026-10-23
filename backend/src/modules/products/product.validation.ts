
import { z } from "zod";

// Nullable text fields
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

// Nullable UUID foreign keys
const uuidOrNull = z.uuid().nullable().optional();

// Product fields
const productFields = z
  .object({
    sku: z
      .string()
      .trim()
      .min(1, "SKU is required")
      .max(40)
      .transform((value) => value.toUpperCase()),

    name: z
      .string()
      .trim()
      .min(2, "Product name must contain at least 2 characters")
      .max(120),

    code: z
      .string()
      .trim()
      .max(60)
      .nullable()
      .transform((value) =>
        value ? value.toUpperCase() : null
      )
      .optional(),

    barcode: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .transform((value) => value || null)
      .optional(),

    description: optionalText(1000),

    imageUrl: z
      .union([z.url(), z.null()])
      .optional(),

    categoryId: uuidOrNull,

    brandId: uuidOrNull,

    unitId: uuidOrNull,

    minStock: z
      .number()
      .int()
      .min(0, "Minimum stock cannot be negative")
      .optional(),

    maxStock: z.number().int().min(0, "Maximum stock cannot be negative").nullable().optional(),

    reorderLeadDays: z.number().int().min(0).max(365).optional(),

    trackBatch: z.boolean().optional(),

    isActive: z.boolean().optional(),
  })
  .strict();

// POST /api/products
export const createProductSchema = productFields;

// PATCH /api/products/:id
export const updateProductSchema = productFields
  .partial()
  .refine(
    (data) => Object.keys(data).length > 0,
    "At least one field is required"
  );

export type CreateProductInput = z.output<
  typeof createProductSchema
>;

export type UpdateProductInput = z.output<
  typeof updateProductSchema
>;
