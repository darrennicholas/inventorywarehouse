import { z } from "zod";

const uuid = z.uuid();
const positiveInt = z.coerce.number().int().positive().max(1_000_000_000);

export const fulfillmentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["PICKING", "PACKED", "SHIPPED", "COMPLETED", "CANCELLED"]).optional(),
  warehouseId: uuid.optional(),
  saleId: uuid.optional(),
  search: z.string().trim().max(100).optional(),
}).strict();

export const createShipmentSchema = z.object({
  number: z.string().trim().min(2).max(60).optional(),
  shippingAddress: z.string().trim().max(1000).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  items: z.array(z.object({
    saleItemId: uuid,
    quantity: positiveInt,
    notes: z.string().trim().max(500).nullable().optional(),
  }).strict()).min(1).max(200),
}).strict();

export const pickShipmentSchema = z.object({
  items: z.array(z.object({
    shipmentItemId: uuid,
    quantity: positiveInt,
  }).strict()).min(1).optional(),
}).strict();

export const shipShipmentSchema = z.object({
  courier: z.string().trim().min(2).max(120),
  trackingNumber: z.string().trim().min(2).max(120),
  shippingAddress: z.string().trim().max(1000).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
}).strict();

export const fulfillmentIdParamsSchema = z.object({ id: uuid });

export type FulfillmentListQuery = z.infer<typeof fulfillmentListQuerySchema>;
export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;
export type PickShipmentInput = z.infer<typeof pickShipmentSchema>;
export type ShipShipmentInput = z.infer<typeof shipShipmentSchema>;
