
import { Router } from "express";

import {
  getCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
} from "./category.controller.ts";

import { validateBody } from "../../middlewares/validate.middleware.ts";

import {
  createCategorySchema,
  updateCategorySchema,
} from "./category.validation.ts";

const router = Router();

router.get("/", getCategories);

router.get("/:id", getCategoryById);

router.post(
  "/",
  validateBody(createCategorySchema),
  createCategory
);

router.patch(
  "/:id",
  validateBody(updateCategorySchema),
  updateCategory
);

router.delete("/:id", deleteCategory);

export default router;
