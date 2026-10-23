-- Complete the batch/location workflow and make receipts auditable.

ALTER TABLE "StockReservation"
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "releaseReason" TEXT;

CREATE INDEX "StockReservation_status_expiresAt_idx"
  ON "StockReservation"("status", "expiresAt");

CREATE TYPE "GoodsReceiptStatus" AS ENUM ('POSTED', 'CANCELLED');

CREATE TABLE "GoodsReceipt" (
  "id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "purchaseOrderId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL,
  "receivedById" UUID NOT NULL,
  "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'POSTED',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoodsReceiptItem" (
  "id" UUID NOT NULL,
  "goodsReceiptId" UUID NOT NULL,
  "purchaseOrderItemId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "locationId" UUID NOT NULL,
  "batchId" UUID,
  "quantity" INTEGER NOT NULL,
  "damagedQuantity" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoodsReceiptItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoodsReceipt_number_key" ON "GoodsReceipt"("number");
CREATE INDEX "GoodsReceipt_purchaseOrderId_idx" ON "GoodsReceipt"("purchaseOrderId");
CREATE INDEX "GoodsReceipt_warehouseId_receivedAt_idx" ON "GoodsReceipt"("warehouseId", "receivedAt");
CREATE INDEX "GoodsReceipt_receivedById_idx" ON "GoodsReceipt"("receivedById");
CREATE INDEX "GoodsReceiptItem_goodsReceiptId_idx" ON "GoodsReceiptItem"("goodsReceiptId");
CREATE INDEX "GoodsReceiptItem_purchaseOrderItemId_idx" ON "GoodsReceiptItem"("purchaseOrderItemId");
CREATE INDEX "GoodsReceiptItem_productId_locationId_idx" ON "GoodsReceiptItem"("productId", "locationId");
CREATE INDEX "GoodsReceiptItem_batchId_idx" ON "GoodsReceiptItem"("batchId");

ALTER TABLE "StockAdjustmentItem"
  ADD COLUMN "locationId" UUID,
  ADD COLUMN "batchId" UUID;
DROP INDEX IF EXISTS "StockAdjustmentItem_adjustmentId_productId_key";
CREATE INDEX "StockAdjustmentItem_adjustmentId_productId_idx" ON "StockAdjustmentItem"("adjustmentId", "productId");

ALTER TABLE "StockTransferItem"
  ADD COLUMN "sourceLocationId" UUID,
  ADD COLUMN "destinationLocationId" UUID,
  ADD COLUMN "batchId" UUID;
DROP INDEX IF EXISTS "StockTransferItem_transferId_productId_key";
CREATE INDEX "StockTransferItem_transferId_productId_idx" ON "StockTransferItem"("transferId", "productId");

ALTER TABLE "GoodsReceipt"
  ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GoodsReceipt_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GoodsReceipt_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GoodsReceiptItem"
  ADD CONSTRAINT "GoodsReceiptItem_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "GoodsReceiptItem_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GoodsReceiptItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GoodsReceiptItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GoodsReceiptItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockAdjustmentItem"
  ADD CONSTRAINT "StockAdjustmentItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "StockAdjustmentItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockTransferItem"
  ADD CONSTRAINT "StockTransferItem_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "StockTransferItem_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "StockTransferItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GoodsReceiptItem"
  ADD CONSTRAINT "GoodsReceiptItem_positive_quantities" CHECK ("quantity" > 0 AND "damagedQuantity" >= 0);
