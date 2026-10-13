
import { Router } from "express";

import { validateBody } from "../../middlewares/validate.middleware.ts";

import {
  createBrandSchema,
  updateBrandSchema,
} from "./brand.validation.ts";

import {
  getBrands,
  getBrandById,
  createBrand,
  updateBrand,
  deactivateBrand,
} from "./brand.controller.ts";

const router = Router();

router.get("/", getBrands);
router.get("/:id", getBrandById);

router.post(
  "/",
  validateBody(createBrandSchema),
  createBrand
);

router.patch(
  "/:id",
  validateBody(updateBrandSchema),
  updateBrand
);

router.delete("/:id", deactivateBrand);

export default router;
