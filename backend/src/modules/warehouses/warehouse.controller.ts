
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { requireUuid } from "../../utils/requireUuid.ts";

import { warehouseService } from "./warehouse.service.ts";
import { createStockCountSheetPdf } from "./warehouse-pdf.ts";

import type {
  CreateWarehouseInput,
  UpdateWarehouseInput,
} from "./warehouse.validation.ts";

// ======================================
// GET /api/warehouses
// ======================================

export const getWarehouses = asyncHandler(
  async (_req, res) => {
    const warehouses = await warehouseService.list();

    res.status(200).json({
      success: true,
      message: "Warehouses retrieved successfully",
      data: warehouses,
    });
  }
);

// ======================================
// GET /api/warehouses/:id
// ======================================

export const getWarehouseById = asyncHandler(
  async (req, res) => {
    const id = requireUuid(req.params.id, "Warehouse ID");

    const warehouse = await warehouseService.detail(id);

    res.status(200).json({
      success: true,
      message: "Warehouse retrieved successfully",
      data: warehouse,
    });
  }
);

// ======================================
// POST /api/warehouses
// ======================================

export const createWarehouse = asyncHandler(
  async (req, res) => {
    const input = req.body as CreateWarehouseInput;

    const warehouse = await warehouseService.create(input);

    res.status(201).json({
      success: true,
      message: "Warehouse created successfully",
      data: warehouse,
    });
  }
);

// ======================================
// PATCH /api/warehouses/:id
// ======================================

export const updateWarehouse = asyncHandler(
  async (req, res) => {
    const id = requireUuid(req.params.id, "Warehouse ID");
    const input = req.body as UpdateWarehouseInput;

    const warehouse = await warehouseService.update(
      id,
      input
    );

    res.status(200).json({
      success: true,
      message: "Warehouse updated successfully",
      data: warehouse,
    });
  }
);

// ======================================
// DELETE /api/warehouses/:id
// ======================================

export const deactivateWarehouse = asyncHandler(
  async (req, res) => {
    const id = requireUuid(req.params.id, "Warehouse ID");

    const warehouse =
      await warehouseService.deactivate(id);

    res.status(200).json({
      success: true,
      message: "Warehouse deactivated successfully",
      data: warehouse,
    });
  }
);

export const downloadStockCountSheet = asyncHandler(async (req, res) => {
  const id = requireUuid(req.params.id, "Warehouse ID");
  const { warehouse, rows } = await warehouseService.stockCountSheet(id);
  const pdf = createStockCountSheetPdf(warehouse, rows);
  const filename = `stock-count-${warehouse.code.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", pdf.length);
  res.status(200).send(pdf);
});
