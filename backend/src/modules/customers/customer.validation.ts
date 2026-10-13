import { z } from "zod";

const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

const customerFields = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, "Customer code is required")
      .max(40)
      .transform((value) => value.toUpperCase()),

    name: z
      .string()
      .trim()
      .min(2, "Customer name must contain at least 2 characters")
      .max(120),

    email: z.union([z.email(), z.null()]).optional(),
    phone: optionalText(30),
    address: optionalText(500),
    isActive: z.boolean().optional(),
  })
  .strict();

export const createCustomerSchema = customerFields;
export const updateCustomerSchema = customerFields.partial();
export const importCustomersSchema = z.object({
  rows: z.array(customerFields).min(1).max(500),
}).strict();

export type CreateCustomerInput = z.output<
  typeof createCustomerSchema
>;
export type UpdateCustomerInput = z.output<typeof updateCustomerSchema>;
export type ImportCustomersInput = z.output<typeof importCustomersSchema>;
