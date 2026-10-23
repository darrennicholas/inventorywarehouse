-- Approval matrix, stock intelligence, and internal warehouse relocation.

ALTER TABLE "Product"
  ADD COLUMN "maxStock" INTEGER,
  ADD COLUMN "reorderLeadDays" INTEGER NOT NULL DEFAULT 7;

CREATE TYPE "ApprovalSubject" AS ENUM ('PURCHASE', 'ADJUSTMENT', 'RETURN', 'STOCK_OPNAME');

CREATE TABLE "ApprovalPolicy" (
  "id" UUID NOT NULL,
  "subject" "ApprovalSubject" NOT NULL,
  "minimumAmount" DECIMAL(14,2) NOT NULL,
  "maximumAmount" DECIMAL(14,2),
  "approverRoleId" UUID NOT NULL,
  "requiresDifferentCreator" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApprovalPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApprovalPolicy_approverRoleId_fkey" FOREIGN KEY ("approverRoleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ApprovalPolicy_subject_isActive_minimumAmount_idx" ON "ApprovalPolicy"("subject", "isActive", "minimumAmount");
CREATE INDEX "ApprovalPolicy_approverRoleId_idx" ON "ApprovalPolicy"("approverRoleId");

ALTER TYPE "StockMovementType" ADD VALUE 'RELOCATION_OUT';
ALTER TYPE "StockMovementType" ADD VALUE 'RELOCATION_IN';
CREATE TYPE "StockRelocationStatus" AS ENUM ('COMPLETED', 'CANCELLED');

CREATE TABLE "StockRelocation" (
  "id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "warehouseId" UUID NOT NULL,
  "fromLocationId" UUID NOT NULL,
  "toLocationId" UUID NOT NULL,
  "createdById" UUID NOT NULL,
  "status" "StockRelocationStatus" NOT NULL DEFAULT 'COMPLETED',
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockRelocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockRelocation_number_key" UNIQUE ("number"),
  CONSTRAINT "StockRelocation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StockRelocation_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StockRelocation_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StockRelocation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "StockRelocation_warehouseId_createdAt_idx" ON "StockRelocation"("warehouseId", "createdAt");
CREATE INDEX "StockRelocation_fromLocationId_idx" ON "StockRelocation"("fromLocationId");
CREATE INDEX "StockRelocation_toLocationId_idx" ON "StockRelocation"("toLocationId");
CREATE INDEX "StockRelocation_createdById_idx" ON "StockRelocation"("createdById");

CREATE TABLE "StockRelocationItem" (
  "id" UUID NOT NULL,
  "relocationId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "batchId" UUID,
  "quantity" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockRelocationItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockRelocationItem_relocationId_fkey" FOREIGN KEY ("relocationId") REFERENCES "StockRelocation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StockRelocationItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StockRelocationItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "StockRelocationItem_quantity_check" CHECK ("quantity" > 0)
);
CREATE INDEX "StockRelocationItem_relocationId_idx" ON "StockRelocationItem"("relocationId");
CREATE INDEX "StockRelocationItem_productId_idx" ON "StockRelocationItem"("productId");
CREATE INDEX "StockRelocationItem_batchId_idx" ON "StockRelocationItem"("batchId");
