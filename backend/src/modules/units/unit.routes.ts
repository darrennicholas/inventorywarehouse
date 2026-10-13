
import { Router } from "express";

import { validateBody } from "../../middlewares/validate.middleware.ts";

import {
  createUnitSchema,
  updateUnitSchema,
} from "./unit.validation.ts";

import {
  getUnits,
  getUnitById,
  createUnit,
  updateUnit,
  deactivateUnit,
} from "./unit.controller.ts";

const router = Router();

router.get("/", getUnits);
router.get("/:id", getUnitById);

router.post(
  "/",
  validateBody(createUnitSchema),
  createUnit
);

router.patch(
  "/:id",
  validateBody(updateUnitSchema),
  updateUnit
);

router.delete("/:id", deactivateUnit);

export default router;
