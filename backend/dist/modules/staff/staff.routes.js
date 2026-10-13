import { Router } from "express";
import { validateBody } from "../../middlewares/validate.middleware.js";
import { createStaffSchema, updateStaffSchema, } from "./staff.validation.js";
import { getStaff, getStaffById, createStaff, updateStaff, deactivateStaff, } from "./staff.controller.js";
const router = Router();
// GET ALL STAFF
router.get("/", getStaff);
// GET STAFF DETAIL
router.get("/:id", getStaffById);
// CREATE STAFF
router.post("/", validateBody(createStaffSchema), createStaff);
// UPDATE STAFF
router.patch("/:id", validateBody(updateStaffSchema), updateStaff);
// DEACTIVATE STAFF
router.delete("/:id", deactivateStaff);
export default router;
