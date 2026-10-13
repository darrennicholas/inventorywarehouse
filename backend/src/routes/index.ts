
import { Router } from "express";

// ==========================================
// 1. PUBLIC MODULE ROUTES
// ==========================================

import healthRoutes from "../modules/health/health.routes.ts";

import authRoutes from "../modules/auth/auth.routes.ts";

// ==========================================
// 2. MASTER DATA MODULE ROUTES
// ==========================================

// Product Management
import productRoutes from "../modules/products/product.routes.ts";

// Category Management
import categoryRoutes from "../modules/categories/category.routes.ts";

// Brand Management
import brandRoutes from "../modules/brands/brand.routes.ts";

// Unit Management
import unitRoutes from "../modules/units/unit.routes.ts";

// Warehouse Management
import warehouseRoutes from "../modules/warehouses/warehouse.routes.ts";

// Staff Management
import staffRoutes from "../modules/staff/staff.routes.ts";

// Customer Management
import customerRoutes from "../modules/customers/customer.routes.ts";

// Supplier Management
import supplierRoutes from "../modules/suppliers/supplier.routes.ts";

// Purchase, sales, stock operations and reporting
import operationsRoutes from "../modules/operations/operations.routes.ts";

// ==========================================
// 3. USER & ROLE MANAGEMENT ROUTES
// ==========================================

// User Management
import userRoutes from "../modules/users/user.routes.ts";

// Role Management
import roleRoutes from "../modules/roles/role.routes.ts";

// ==========================================
// 4. AUTHENTICATION & RBAC MIDDLEWARE
// ==========================================

import {
  requireAllowedOrigin,
  requireAuth,
  requireCsrf,
  requirePermission,
  protectModule,
} from "../middlewares/auth.middleware.ts";

// ==========================================
// 5. INITIALIZE EXPRESS ROUTER
// ==========================================

const router = Router();

// ==========================================
// 6. PUBLIC ROUTES
// ==========================================

// Health Check
// Public endpoint for server status
router.use(healthRoutes);

// Authentication
//
// POST /api/auth/login
// GET  /api/auth/me
// POST /api/auth/logout
//
// /me and /logout are protected internally
// in auth.routes.ts.

router.use("/auth", authRoutes);

// ==========================================
// 7. GLOBAL AUTHENTICATION PROTECTION
// ==========================================

// All routes registered BELOW this middleware
// require authentication.
//
// requireAllowedOrigin:
//   Validates Origin for unsafe HTTP methods.
//
// requireAuth:
//   Validates the current session.
//
// requireCsrf:
//   Validates CSRF token for POST, PUT,
//   PATCH and DELETE requests.

router.use(
  requireAllowedOrigin,
  requireAuth,
  requireCsrf
);

// ==========================================
// 8. USER MANAGEMENT
// ==========================================

// Permission required:
// users.manage
//
// GET    /api/users
// GET    /api/users/options
// GET    /api/users/:id
// POST   /api/users
// PATCH  /api/users/:id
// DELETE /api/users/:id

router.use(
  "/users",
  requirePermission("users.manage"),
  userRoutes
);

// ==========================================
// 9. ROLE MANAGEMENT
// ==========================================

// Permission required:
// roles.manage
//
// GET    /api/roles
// GET    /api/roles/permissions
// POST   /api/roles
// PATCH  /api/roles/:id
// DELETE /api/roles/:id

router.use(
  "/roles",
  requirePermission("roles.manage"),
  roleRoutes
);

// ==========================================
// 10. PRODUCT MANAGEMENT
// ==========================================

// GET / HEAD -> products.read
// POST / PUT / PATCH / DELETE
//            -> products.write

router.use(
  "/products",
  protectModule("products"),
  productRoutes
);

// ==========================================
// 11. CATEGORY MANAGEMENT
// ==========================================

// GET    -> categories.read
// Others -> categories.write

router.use(
  "/categories",
  protectModule("categories"),
  categoryRoutes
);

// ==========================================
// 12. BRAND MANAGEMENT
// ==========================================

// GET    -> brands.read
// Others -> brands.write

router.use(
  "/brands",
  protectModule("brands"),
  brandRoutes
);

// ==========================================
// 13. UNIT MANAGEMENT
// ==========================================

// GET    -> units.read
// Others -> units.write

router.use(
  "/units",
  protectModule("units"),
  unitRoutes
);

// ==========================================
// 14. WAREHOUSE MANAGEMENT
// ==========================================

// GET    -> warehouses.read
// Others -> warehouses.write

router.use(
  "/warehouses",
  protectModule("warehouses"),
  warehouseRoutes
);

// ==========================================
// 15. STAFF MANAGEMENT
// ==========================================

// GET    -> staff.read
// Others -> staff.write

router.use(
  "/staff",
  protectModule("staff"),
  staffRoutes
);

// ==========================================
// 16. CUSTOMER MANAGEMENT
// ==========================================

// GET    -> customers.read
// Others -> customers.write

router.use(
  "/customers",
  protectModule("customers"),
  customerRoutes
);

// ==========================================
// 17. SUPPLIER MANAGEMENT
// ==========================================

// GET    -> suppliers.read
// Others -> suppliers.write

router.use(
  "/suppliers",
  protectModule("suppliers"),
  supplierRoutes
);

// ==========================================
// 18. PURCHASE, SALES & STOCK OPERATIONS
// ==========================================

// The operations router applies the appropriate
// permission to each endpoint (purchases, sales,
// adjustments, transfers and reports).
router.use("/operations", operationsRoutes);

// ==========================================
// 19. EXPORT ROUTER
// ==========================================

export default router;
