import { Router } from "express";
import transactionRoutes from "./transaction.routes.ts";
import financeRoutes from "./finance.routes.ts";

// Stable public entry point. Domain routers are mounted here so existing
// /api/operations URLs remain backward compatible during modularization.
const router = Router();
router.use(financeRoutes);
router.use(transactionRoutes);

export default router;
