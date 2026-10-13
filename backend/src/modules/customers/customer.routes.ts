import { Router } from "express";

import { validateBody } from "../../middlewares/validate.middleware.ts";
import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
  importCustomers,
} from "./customer.controller.ts";
import { createCustomerSchema, importCustomersSchema, updateCustomerSchema } from "./customer.validation.ts";

const router = Router();

router.get("/", listCustomers);
router.get("/:id", getCustomer);

router.post("/import", validateBody(importCustomersSchema), importCustomers);

router.post(
  "/",
  validateBody(createCustomerSchema),
  createCustomer
);

router.patch("/:id", validateBody(updateCustomerSchema), updateCustomer);
router.delete("/:id", deleteCustomer);

export default router;
