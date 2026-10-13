import { Router } from "express";
import { healthCheck, databaseCheck, } from "./health.controller.js";
const router = Router();
router.get("/health", healthCheck);
router.get("/database-check", databaseCheck);
export default router;
