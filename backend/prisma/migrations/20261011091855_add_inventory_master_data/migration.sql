
/*
  Migration: add_inventory_master_data

  Inventory & Warehouse Management System
  Database: PostgreSQL
  ORM: Prisma ORM 7

  Changes:
  1. Add new columns to Product
  2. Create Category
  3. Create Brand
  4. Create Unit
  5. Create Warehouse
  6. Create Supplier
  7. Create InventoryBalance
  8. Create indexes and unique constraints
  9. Create foreign key relationships
  10. Prevent negative stock quantities

  Notes:
  - Existing Product records are preserved.
  - code and barcode are nullable and unique.
  - categoryId, brandId and unitId are nullable.
  - No existing Product columns are dropped.
*/


-- ==========================================
-- 1. ALTER TABLE PRODUCT
-- ==========================================

ALTER TABLE "Product"
    ADD COLUMN "barcode" TEXT,
    ADD COLUMN "brandId" UUID,
    ADD COLUMN "categoryId" UUID,
    ADD COLUMN "code" TEXT,
    ADD COLUMN "description" TEXT,
    ADD COLUMN "imageUrl" TEXT,
    ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN "minStock" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "unitId" UUID;


-- ==========================================
-- 2. CREATE TABLE CATEGORY
-- ==========================================

CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey"
        PRIMARY KEY ("id")
);


-- ==========================================
-- 3. CREATE TABLE BRAND
-- ==========================================

CREATE TABLE "Brand" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey"
        PRIMARY KEY ("id")
);


-- ==========================================
-- 4. CREATE TABLE UNIT
-- ==========================================

CREATE TABLE "Unit" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey"
        PRIMARY KEY ("id")
);


-- ==========================================
-- 5. CREATE TABLE WAREHOUSE
-- ==========================================

CREATE TABLE "Warehouse" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey"
        PRIMARY KEY ("id")
);


-- ==========================================
-- 6. CREATE TABLE SUPPLIER
-- ==========================================

CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey"
        PRIMARY KEY ("id")
);


-- ==========================================
-- 7. CREATE TABLE INVENTORY BALANCE
-- ==========================================

CREATE TABLE "InventoryBalance" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "quantityOnHand" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryBalance_pkey"
        PRIMARY KEY ("id")
);


-- ==========================================
-- 8. CREATE UNIQUE INDEXES
-- ==========================================

-- Category name must be unique
CREATE UNIQUE INDEX "Category_name_key"
ON "Category"("name");

-- Brand name must be unique
CREATE UNIQUE INDEX "Brand_name_key"
ON "Brand"("name");

-- Unit code must be unique
CREATE UNIQUE INDEX "Unit_code_key"
ON "Unit"("code");

-- Warehouse code must be unique
CREATE UNIQUE INDEX "Warehouse_code_key"
ON "Warehouse"("code");

-- Supplier code must be unique
CREATE UNIQUE INDEX "Supplier_code_key"
ON "Supplier"("code");

-- Product code must be unique when provided
CREATE UNIQUE INDEX "Product_code_key"
ON "Product"("code");

-- Product barcode must be unique when provided
CREATE UNIQUE INDEX "Product_barcode_key"
ON "Product"("barcode");

-- One balance record per product and warehouse
CREATE UNIQUE INDEX
"InventoryBalance_productId_warehouseId_key"
ON "InventoryBalance"("productId", "warehouseId");


-- ==========================================
-- 9. CREATE NORMAL INDEXES
-- ==========================================

-- Product category lookup
CREATE INDEX "Product_categoryId_idx"
ON "Product"("categoryId");

-- Product brand lookup
CREATE INDEX "Product_brandId_idx"
ON "Product"("brandId");

-- Product unit lookup
CREATE INDEX "Product_unitId_idx"
ON "Product"("unitId");

-- Warehouse stock lookup
CREATE INDEX "InventoryBalance_warehouseId_idx"
ON "InventoryBalance"("warehouseId");


-- ==========================================
-- 10. PRODUCT FOREIGN KEYS
-- ==========================================

-- Product belongs to Category
ALTER TABLE "Product"
ADD CONSTRAINT "Product_categoryId_fkey"
FOREIGN KEY ("categoryId")
REFERENCES "Category"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- Product belongs to Brand
ALTER TABLE "Product"
ADD CONSTRAINT "Product_brandId_fkey"
FOREIGN KEY ("brandId")
REFERENCES "Brand"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- Product belongs to Unit
ALTER TABLE "Product"
ADD CONSTRAINT "Product_unitId_fkey"
FOREIGN KEY ("unitId")
REFERENCES "Unit"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;


-- ==========================================
-- 11. INVENTORY BALANCE FOREIGN KEYS
-- ==========================================

-- Inventory balance references Product
ALTER TABLE "InventoryBalance"
ADD CONSTRAINT "InventoryBalance_productId_fkey"
FOREIGN KEY ("productId")
REFERENCES "Product"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

-- Inventory balance references Warehouse
ALTER TABLE "InventoryBalance"
ADD CONSTRAINT "InventoryBalance_warehouseId_fkey"
FOREIGN KEY ("warehouseId")
REFERENCES "Warehouse"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;


-- ==========================================
-- 12. INVENTORY STOCK CONSTRAINTS
-- ==========================================

-- Prevent stock quantity from becoming negative
ALTER TABLE "InventoryBalance"
ADD CONSTRAINT "InventoryBalance_quantity_nonnegative"
CHECK ("quantityOnHand" >= 0);

-- Prevent minimum stock threshold from being negative
ALTER TABLE "Product"
ADD CONSTRAINT "Product_minStock_nonnegative"
CHECK ("minStock" >= 0);


-- ==========================================
-- END OF MIGRATION
-- ==========================================
