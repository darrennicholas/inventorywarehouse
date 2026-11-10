import { z } from "zod";

export const createUserSchema = z.object({
  fullName: z.string()
    .trim()
    .min(2)
    .max(120),

  email: z.string()
    .trim()
    .toLowerCase()
    .pipe(z.email()),

  password: z.string()
    .min(12)
    .max(128),

  roleId: z.uuid(),

  staffId: z.uuid()
    .nullable()
    .optional(),

  isActive: z.boolean()
    .optional(),
}).strict();

export const updateUserSchema = createUserSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    {
      message: "At least one field is required",
    }
  );

// ==========================================
// USER RESPONSE FIELDS
// ==========================================

// Never return passwordHash.

export const userSelect = {
  id: true,
  email: true,
  fullName: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,

  role: {
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
    },
  },

  staff: {
    select: {
      id: true,
      staffCode: true,
      fullName: true,
    },
  },
} as const;

// ==========================================
