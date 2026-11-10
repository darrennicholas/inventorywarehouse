import { Router } from "express";
import readRoutes from "./role-read.routes.ts";
import writeRoutes from "./role-write.routes.ts";

// Keep the public module path stable while separating read and mutation endpoints.
const router = Router();
router.use(readRoutes);
router.use(writeRoutes);

export default router;
