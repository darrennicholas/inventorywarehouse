
import { Router } from "express";

import { validateBody } from "../../middlewares/validate.middleware.ts";

import {
  createStaffSchema,
  updateStaffSchema,
} from "./staff.validation.ts";

import {
  getStaff,
  getStaffById,
  createStaff,
  updateStaff,
  deactivateStaff,
} from "./staff.controller.ts";

const router = Router();

// GET ALL STAFF
router.get("/", getStaff);

// GET STAFF DETAIL
router.get("/:id", getStaffById);

// CREATE STAFF
router.post(
  "/",
  validateBody(createStaffSchema),
  createStaff
);

// UPDATE STAFF
router.patch(
  "/:id",
  validateBody(updateStaffSchema),
  updateStaff
);

// DEACTIVATE STAFF
router.delete(
  "/:id",
  deactivateStaff
);

export default router;
