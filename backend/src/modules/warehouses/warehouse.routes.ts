
import { Router } from "express";
import { z } from "zod";

import { validateBody } from "../../middlewares/validate.middleware.ts";
import { prisma } from "../../lib/prisma.ts";
import { authOf } from "../../middlewares/auth.middleware.ts";
import { assertWarehouseAccess } from "../../rbac/warehouse-scope.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";

import {
  createWarehouseSchema,
  updateWarehouseSchema,
} from "./warehouse.validation.ts";

import {
  getWarehouses,
  getWarehouseById,
  createWarehouse,
  updateWarehouse,
  deactivateWarehouse,
  downloadStockCountSheet,
} from "./warehouse.controller.ts";

const router = Router();

const locationSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(2).max(100),
  zone: z.string().trim().max(40).nullable().optional(),
  rack: z.string().trim().max(40).nullable().optional(),
  shelf: z.string().trim().max(40).nullable().optional(),
  bin: z.string().trim().max(40).nullable().optional(),
  capacity: z.coerce.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
}).strict();

router.get("/:warehouseId/locations", asyncHandler(async (req, res) => {
  const warehouseId = z.uuid().parse(req.params.warehouseId);
  assertWarehouseAccess(authOf(req), warehouseId);
  const data = await prisma.warehouseLocation.findMany({ where: { warehouseId }, orderBy: [{ isActive: "desc" }, { code: "asc" }] });
  res.json({ success: true, data });
}));

router.post("/:warehouseId/locations", asyncHandler(async (req, res) => {
  const warehouseId = z.uuid().parse(req.params.warehouseId);
  assertWarehouseAccess(authOf(req), warehouseId);
  const input = locationSchema.parse(req.body);
  const data = await prisma.warehouseLocation.create({ data: { warehouseId, code: input.code.toUpperCase(), name: input.name, zone: input.zone ?? null, rack: input.rack ?? null, shelf: input.shelf ?? null, bin: input.bin ?? null, capacity: input.capacity ?? null, isActive: input.isActive ?? true } });
  await notifyByPermission({ permission: "warehouses.read", type: "LOCATION_CREATED", title: "Warehouse location added", message: `${data.code} was added to warehouse storage.`, entity: "WarehouseLocation", entityId: data.id, warehouseId });
  res.status(201).json({ success: true, message: "Warehouse location created successfully", data });
}));

router.patch("/:warehouseId/locations/:locationId", asyncHandler(async (req, res) => {
  const warehouseId = z.uuid().parse(req.params.warehouseId);
  const id = z.uuid().parse(req.params.locationId);
  assertWarehouseAccess(authOf(req), warehouseId);
  const input = locationSchema.partial().refine((value) => Object.keys(value).length > 0, "At least one field is required").parse(req.body);
  const current = await prisma.warehouseLocation.findFirst({ where: { id, warehouseId } });
  if (!current) { res.status(404).json({ success: false, message: "Warehouse location not found" }); return; }
  const data = await prisma.warehouseLocation.update({ where: { id }, data: { ...input, ...(input.code ? { code: input.code.toUpperCase() } : {}) } });
  await notifyByPermission({ permission: "warehouses.read", type: "LOCATION_UPDATED", title: "Warehouse location updated", message: `${data.code} was updated.`, entity: "WarehouseLocation", entityId: data.id, warehouseId });
  res.json({ success: true, message: "Warehouse location updated successfully", data });
}));

router.delete("/:warehouseId/locations/:locationId", asyncHandler(async (req, res) => {
  const warehouseId = z.uuid().parse(req.params.warehouseId);
  const id = z.uuid().parse(req.params.locationId);
  assertWarehouseAccess(authOf(req), warehouseId);
  const current = await prisma.warehouseLocation.findFirst({ where: { id, warehouseId } });
  if (!current) { res.status(404).json({ success: false, message: "Warehouse location not found" }); return; }
  await prisma.warehouseLocation.update({ where: { id }, data: { isActive: false } });
  await notifyByPermission({ permission: "warehouses.read", type: "LOCATION_DEACTIVATED", title: "Warehouse location deactivated", message: `${current.code} was deactivated.`, entity: "WarehouseLocation", entityId: current.id, warehouseId });
  res.json({ success: true, message: "Warehouse location deactivated successfully" });
}));

// GET ALL
router.get("/", getWarehouses);

router.get("/:id/stock-count-sheet.pdf", downloadStockCountSheet);

// GET DETAIL
router.get("/:id", getWarehouseById);

// CREATE
router.post(
  "/",
  validateBody(createWarehouseSchema),
  createWarehouse
);

// UPDATE
router.patch(
  "/:id",
  validateBody(updateWarehouseSchema),
  updateWarehouse
);

// SOFT DELETE
router.delete(
  "/:id",
  deactivateWarehouse
);

export default router;
