
import { Router } from "express";

import { validateBody } from "../../middlewares/validate.middleware.ts";

import {
  createSupplierSchema,
  updateSupplierSchema,
} from "./supplier.validation.ts";

import {
  createSupplier,
  deactivateSupplier,
  getSupplierById,
  getSuppliers,
  updateSupplier,
} from "./supplier.controller.ts";

const router = Router();

router.get("/", getSuppliers);
router.get("/:id", getSupplierById);

router.post(
  "/",
  validateBody(createSupplierSchema),
  createSupplier
);

router.patch(
  "/:id",
  validateBody(updateSupplierSchema),
  updateSupplier
);

router.delete(
  "/:id",
  deactivateSupplier
);

export default router;
