CREATE TABLE "InventoryValuationSnapshot" (
  "id" UUID NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "productId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL,
  "quantityOnHand" INTEGER NOT NULL,
  "averageUnitCost" DECIMAL(20,6),
  "knownValue" DECIMAL(20,2),
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryValuationSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryValuationSnapshot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InventoryValuationSnapshot_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InventoryValuationSnapshot_quantity_nonnegative" CHECK ("quantityOnHand" >= 0),
  CONSTRAINT "InventoryValuationSnapshot_cost_nonnegative" CHECK ("averageUnitCost" IS NULL OR "averageUnitCost" >= 0),
  CONSTRAINT "InventoryValuationSnapshot_value_nonnegative" CHECK ("knownValue" IS NULL OR "knownValue" >= 0)
);

CREATE UNIQUE INDEX "InventoryValuationSnapshot_snapshotDate_productId_warehouseId_key"
  ON "InventoryValuationSnapshot"("snapshotDate", "productId", "warehouseId");
CREATE INDEX "InventoryValuationSnapshot_snapshotDate_warehouseId_idx"
  ON "InventoryValuationSnapshot"("snapshotDate", "warehouseId");
