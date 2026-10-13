import { z } from "zod";
export const createCategorySchema = z.object({
    name: z.string().trim().min(2).max(100),
    description: z
        .string()
        .trim()
        .max(500)
        .nullable()
        .optional(),
    isActive: z.boolean().optional(),
}).strict();
export const updateCategorySchema = createCategorySchema.partial().refine((data) => Object.keys(data).length > 0, "At least one field is required");
