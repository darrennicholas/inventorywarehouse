import { Router } from "express";
import optionsRoutes from "./transaction-options.routes.ts";
import purchaseRoutes from "./purchase.routes.ts";
import saleRoutes from "./sale.routes.ts";
import adjustmentTransferRoutes from "./stock-adjustment-transfer.routes.ts";

// Preserve the existing /api/operations contract while keeping each inventory
// transaction domain in its own route module.
const router = Router();
router.use(optionsRoutes);
router.use(purchaseRoutes);
router.use(saleRoutes);
router.use(adjustmentTransferRoutes);

export default router;