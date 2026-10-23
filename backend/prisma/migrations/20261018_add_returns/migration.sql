-- StockFlow: Purchase Return & Sales Return (additive migration)
-- Based on the supplied schema.prisma snapshot, not a production DB inspection.
-- Review against migration history. Backup database before applying.
-- NO data backfill / existing inventory mutation occurs in this migration.

-- New enums
CREATE TYPE "ReturnType" AS ENUM ('PURCHASE', 'SALE');
CREATE TYPE "ReturnStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'POSTED', 'CANCELLED');
CREATE TYPE "ReturnCondition" AS ENUM ('GOOD', 'DAMAGED', 'EXPIRED', 'DEFECTIVE');
CREATE TYPE "ReturnDisposition" AS ENUM ('RESTOCK', 'QUARANTINE', 'SCRAP');
CREATE TYPE "WarehouseLocationType" AS ENUM ('STORAGE', 'RECEIVING', 'QUARANTINE', 'DAMAGED');

-- Add classification of physical warehouse locations.
ALTER TABLE "WarehouseLocation"
  ADD COLUMN "locationType" "WarehouseLocationType" NOT NULL DEFAULT 'STORAGE';

-- Extend the existing PostgreSQL enum without touching old values.
ALTER TYPE "StockMovementType" ADD VALUE 'PURCHASE_RETURN';
ALTER TYPE "StockMovementType" ADD VALUE 'SALES_RETURN';

-- Return header
CREATE TABLE "ReturnOrder" (
  "id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "type" "ReturnType" NOT NULL,
  "purchaseOrderId" UUID,
  "saleId" UUID,
  "warehouseId" UUID NOT NULL,
  "createdById" UUID NOT NULL,
  "approvedById" UUID,
  "status" "ReturnStatus" NOT NULL DEFAULT 'DRAFT',
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "approvedAt" TIMESTAMP(3),
  "postedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReturnOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "return_order_source_xor_ck" CHECK (
    ("type" = 'PURCHASE' AND "purchaseOrderId" IS NOT NULL AND "saleId" IS NULL)
    OR
    ("type" = 'SALE' AND "saleId" IS NOT NULL AND "purchaseOrderId" IS NULL)
  )
);

-- Return line items
CREATE TABLE "ReturnOrderItem" (
  "id" UUID NOT NULL,
  "returnOrderId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "purchaseOrderItemId" UUID,
  "saleItemId" UUID,
  "locationId" UUID,
  "batchId" UUID,
  "quantity" INTEGER NOT NULL,
  "condition" "ReturnCondition" NOT NULL,
  "disposition" "ReturnDisposition" NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReturnOrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "return_order_item_qty_positive_ck" CHECK ("quantity" > 0),
  CONSTRAINT "return_order_item_one_source_item_ck" CHECK (
     ("purchaseOrderItemId" IS NOT NULL AND "saleItemId" IS NULL)
     OR
     ("purchaseOrderItemId" IS NULL AND "saleItemId" IS NOT NULL)
  )
);

-- Direct traceability to the return document on stock movements.
ALTER TABLE "StockMovement" ADD COLUMN "returnOrderId" UUID;

-- Indexes
CREATE UNIQUE INDEX "ReturnOrder_number_key" ON "ReturnOrder"("number");
CREATE INDEX "ReturnOrder_type_status_createdAt_idx" ON "ReturnOrder"("type", "status", "createdAt");
CREATE INDEX "ReturnOrder_purchaseOrderId_idx" ON "ReturnOrder"("purchaseOrderId");
CREATE INDEX "ReturnOrder_saleId_idx" ON "ReturnOrder"("saleId");
CREATE INDEX "ReturnOrder_warehouseId_status_idx" ON "ReturnOrder"("warehouseId", "status");
CREATE INDEX "ReturnOrder_createdById_idx" ON "ReturnOrder"("createdById");
CREATE INDEX "ReturnOrder_approvedById_idx" ON "ReturnOrder"("approvedById");

CREATE INDEX "ReturnOrderItem_returnOrderId_idx" ON "ReturnOrderItem"("returnOrderId");
CREATE INDEX "ReturnOrderItem_productId_idx" ON "ReturnOrderItem"("productId");
CREATE INDEX "ReturnOrderItem_purchaseOrderItemId_idx" ON "ReturnOrderItem"("purchaseOrderItemId");
CREATE INDEX "ReturnOrderItem_saleItemId_idx" ON "ReturnOrderItem"("saleItemId");
CREATE INDEX "ReturnOrderItem_locationId_idx" ON "ReturnOrderItem"("locationId");
CREATE INDEX "ReturnOrderItem_batchId_idx" ON "ReturnOrderItem"("batchId");
CREATE INDEX "StockMovement_returnOrderId_idx" ON "StockMovement"("returnOrderId");

-- Foreign keys
ALTER TABLE "ReturnOrder"
  ADD CONSTRAINT "ReturnOrder_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnOrder"
  ADD CONSTRAINT "ReturnOrder_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnOrder"
  ADD CONSTRAINT "ReturnOrder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnOrder"
  ADD CONSTRAINT "ReturnOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnOrder"
  ADD CONSTRAINT "ReturnOrder_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReturnOrderItem"
  ADD CONSTRAINT "ReturnOrderItem_returnOrderId_fkey" FOREIGN KEY ("returnOrderId") REFERENCES "ReturnOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReturnOrderItem"
  ADD CONSTRAINT "ReturnOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnOrderItem"
  ADD CONSTRAINT "ReturnOrderItem_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnOrderItem"
  ADD CONSTRAINT "ReturnOrderItem_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnOrderItem"
  ADD CONSTRAINT "ReturnOrderItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnOrderItem"
  ADD CONSTRAINT "ReturnOrderItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_returnOrderId_fkey" FOREIGN KEY ("returnOrderId") REFERENCES "ReturnOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- NOTE: Source item must belong to ReturnOrder's selected Purchase/Sale, and
-- product/batch/location must belong to its product/warehouse. Enforce this
-- in Return validation and transactional service prior to posting.
-- Different dispositions must be checked against return type and locationType.
-- Avoid attempting to include quarantined stock in sellable available quantity.
