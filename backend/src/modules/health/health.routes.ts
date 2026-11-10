
import { Router } from "express";

import {
  healthCheck,
  databaseCheck,
  readinessCheck,
} from "./health.controller.ts";

const router = Router();

router.get("/health", healthCheck);
router.get("/ready", readinessCheck);

router.get("/database-check", databaseCheck);

export default router;
