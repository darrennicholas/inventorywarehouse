
import { z } from "zod";

// ======================================
// WAREHOUSE CODE VALIDATION
// ======================================

const warehouseCodeSchema = z
  .string()
  .trim()
  .min(2, "Warehouse code must contain at least 2 characters")
  .max(30, "Warehouse code cannot exceed 30 characters")
  .transform((value) => value.toUpperCase())
  .pipe(
    z.string().regex(
      /^[A-Z0-9][A-Z0-9_-]*$/,
      "Warehouse code may contain letters, numbers, - and _"
    )
  );

// ======================================
// CREATE WAREHOUSE
// ======================================

export const createWarehouseSchema = z
  .object({
    code: warehouseCodeSchema,

    name: z
      .string()
      .trim()
      .min(2, "Warehouse name must contain at least 2 characters")
      .max(120, "Warehouse name cannot exceed 120 characters"),

    address: z
      .string()
      .trim()
      .max(500, "Address cannot exceed 500 characters")
      .nullable()
      .optional(),

    isActive: z.boolean().optional(),
  })
  .strict();

// ======================================
// UPDATE WAREHOUSE
// ======================================

export const updateWarehouseSchema =
  createWarehouseSchema.partial().refine(
    (data) => Object.keys(data).length > 0,
    {
      message: "At least one field is required",
    }
  );

// ======================================
// TYPES
// ======================================

export type CreateWarehouseInput = z.output<
  typeof createWarehouseSchema
>;

export type UpdateWarehouseInput = z.output<
  typeof updateWarehouseSchema
>;
