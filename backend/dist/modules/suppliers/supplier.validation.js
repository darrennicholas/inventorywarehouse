import { z } from "zod";
const blankToNull = (value) => typeof value === "string" && value.trim() === ""
    ? null
    : value;
const optionalText = (max) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const optionalEmail = z.preprocess((value) => {
    if (typeof value !== "string")
        return value;
    return value.trim().toLowerCase() || null;
}, z.email("Invalid supplier email")
    .max(254)
    .nullable()
    .optional());
const supplierCode = z
    .string()
    .trim()
    .min(2, "Supplier code must be at least 2 characters")
    .max(40, "Supplier code cannot exceed 40 characters")
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9_-]*$/, "Supplier code may contain letters, numbers, - and _"));
export const createSupplierSchema = z
    .object({
    code: supplierCode,
    name: z.string().trim().min(2).max(120),
    email: optionalEmail,
    phone: optionalText(30),
    address: optionalText(500),
    isActive: z.boolean().optional(),
})
    .strict();
export const updateSupplierSchema = createSupplierSchema
    .partial()
    .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
});
