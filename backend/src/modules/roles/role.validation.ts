import { z } from "zod";

export const createRoleSchema = z.object({
  code: z.string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(50)
    .regex(
      /^[A-Z][A-Z0-9_]*$/,
      "Role code must contain uppercase letters, numbers or underscores"
    ),

  name: z.string()
    .trim()
    .min(2)
    .max(100),

  description: z.string()
    .trim()
    .max(300)
    .nullable()
    .optional(),

  permissions: z.array(
    z.string().min(1)
  ).max(100),

  isActive: z.boolean()
    .optional(),
}).strict();

export const updateRoleSchema = createRoleSchema
  .partial()
  .refine(
    (value) =>
      Object.keys(value).length > 0,
    {
      message: "At least one field is required",
    }
  );

// ==========================================
// ROLE QUERY RELATIONS
// ==========================================

export const roleInclude = {
  permissions: {
    include: {
      permission: true,
    },
  },
} as const;
