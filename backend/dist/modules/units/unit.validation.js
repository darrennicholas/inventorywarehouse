import { z } from "zod";
const unitCodeSchema = z.string()
    .trim()
    .min(1, "Unit code is required")
    .max(20)
    .transform(value => value.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9_-]+$/, "Unit code may contain letters, numbers, _ and -"));
export const createUnitSchema = z.object({
    code: unitCodeSchema,
    name: z.string().trim().min(2).max(100),
    isActive: z.boolean().optional(),
}).strict();
export const updateUnitSchema = createUnitSchema.partial().refine(data => Object.keys(data).length > 0, "At least one field is required");
