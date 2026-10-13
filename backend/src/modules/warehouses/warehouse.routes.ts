
import { Router } from "express";

import { validateBody } from "../../middlewares/validate.middleware.ts";

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
