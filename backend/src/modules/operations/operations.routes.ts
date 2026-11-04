import { Router } from "express";
import transactionRoutes from "./transaction.routes.ts";
import financeRoutes from "./finance.routes.ts";
import dashboardRoutes from "./dashboard.routes.ts";
import inventoryInsightsRoutes from "./inventory-insights.routes.ts";
import workflowRoutes from "./workflow.routes.ts";
import settlementRoutes from "./settlement.routes.ts";
import valuationRoutes from "./valuation.routes.ts";
import quarantineRoutes from "./quarantine.routes.ts";
import inventoryReportRoutes from "./inventory-report.routes.ts";

// Stable public entry point. Domain routers are mounted here so existing
// /api/operations URLs remain backward compatible during modularization.
const router = Router();
router.use(financeRoutes);
router.use(settlementRoutes);
router.use(valuationRoutes);
router.use(quarantineRoutes);
router.use(dashboardRoutes);
router.use(inventoryInsightsRoutes);
router.use(workflowRoutes);
router.use(transactionRoutes);
router.use(inventoryReportRoutes);

export default router;
