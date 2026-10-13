import { z } from "zod";
// ======================================
// VALIDATION STAFF CODE
// ======================================
const staffCodeSchema = z
    .string()
    .trim()
    .min(2, "Staff code must contain at least 2 characters")
    .max(40, "Staff code cannot exceed 40 characters")
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9_-]*$/, "Only letters, numbers, _ and - are allowed"));
// ======================================
// VALIDATION EMAIL
// ======================================
const emailSchema = z
    .string()
    .trim()
    .max(254)
    .transform((value) => value.toLowerCase())
    .pipe(z.email("Invalid email address"))
    .nullable()
    .optional();
// ======================================
// CREATE STAFF
// ======================================
export const createStaffSchema = z
    .object({
    staffCode: staffCodeSchema,
    fullName: z
        .string()
        .trim()
        .min(2, "Full name must contain at least 2 characters")
        .max(120),
    email: emailSchema,
    phone: z
        .string()
        .trim()
        .max(30)
        .nullable()
        .optional(),
    position: z
        .string()
        .trim()
        .max(100)
        .nullable()
        .optional(),
    warehouseId: z.uuid().nullable().optional(),
    isActive: z.boolean().optional(),
})
    .strict();
// ======================================
// UPDATE STAFF
// ======================================
export const updateStaffSchema = createStaffSchema.partial().refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
});
