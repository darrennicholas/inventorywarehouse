import { z } from "zod";
export const createBrandSchema = z.object({
    name: z.string().trim().min(2).max(100),
    isActive: z.boolean().optional(),
}).strict();
export const updateBrandSchema = createBrandSchema.partial().refine(data => Object.keys(data).length > 0, "At least one field is required");
