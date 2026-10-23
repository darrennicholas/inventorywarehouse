-- StockFlow Stage 1 - inventory by batch + location (STRUCTURE ONLY)
-- PostgreSQL; pairs with backend/prisma/schema.prisma.
-- IMPORTANT: This migration DOES NOT backfill or modify legacy stock balances.
-- Apply only after reviewing a full database backup and testing against a copy.

-- -----------------------------------------------
-- 1. New, initially empty detail balance table
-- -----------------------------------------------
CREATE TABLE "InventoryLocationBalance" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "batchId" UUID,
    "quantityOnHand" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryLocationBalance_pkey" PRIMARY KEY ("id")
);

-- -----------------------------------------------
-- 2. New movement-to-location allocation table
-- -----------------------------------------------
CREATE TABLE "StockMovementAllocation" (
    "id" UUID NOT NULL,
    "stockMovementId" UUID NOT NULL,
    "inventoryLocationBalanceId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovementAllocation_pkey" PRIMARY KEY ("id")
);

-- Add a nullable link: existing StockReservation rows stay valid.
ALTER TABLE "StockReservation"
ADD COLUMN "locationBalanceId" UUID;

-- -----------------------------------------------
-- 3. Indexes (identical to the Prisma @@index declarations)
-- -----------------------------------------------
CREATE INDEX "InventoryLocationBalance_productId_warehouseId_idx"
  ON "InventoryLocationBalance"("productId", "warehouseId");
CREATE INDEX "InventoryLocationBalance_warehouseId_locationId_idx"
  ON "InventoryLocationBalance"("warehouseId", "locationId");
CREATE INDEX "InventoryLocationBalance_batchId_idx"
  ON "InventoryLocationBalance"("batchId");

CREATE INDEX "StockMovementAllocation_stockMovementId_idx"
  ON "StockMovementAllocation"("stockMovementId");
CREATE INDEX "StockMovementAllocation_inventoryLocationBalanceId_idx"
  ON "StockMovementAllocation"("inventoryLocationBalanceId");
CREATE INDEX "StockMovementAllocation_createdAt_idx"
  ON "StockMovementAllocation"("createdAt");

CREATE INDEX "StockReservation_locationBalanceId_idx"
  ON "StockReservation"("locationBalanceId");

-- Two indexes are needed because a standard UNIQUE including nullable batchId
-- allows duplicate rows where batchId IS NULL.
CREATE UNIQUE INDEX "invloc_unique_with_batch"
  ON "InventoryLocationBalance"("productId", "warehouseId", "locationId", "batchId")
  WHERE "batchId" IS NOT NULL;

CREATE UNIQUE INDEX "invloc_unique_without_batch"
  ON "InventoryLocationBalance"("productId", "warehouseId", "locationId")
  WHERE "batchId" IS NULL;

-- -----------------------------------------------
-- 4. Foreign keys: preserve legacy data and prohibit orphan detail rows
-- -----------------------------------------------
ALTER TABLE "InventoryLocationBalance"
  ADD CONSTRAINT "InventoryLocationBalance_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryLocationBalance"
  ADD CONSTRAINT "InventoryLocationBalance_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryLocationBalance"
  ADD CONSTRAINT "InventoryLocationBalance_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryLocationBalance"
  ADD CONSTRAINT "InventoryLocationBalance_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "ProductBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovementAllocation"
  ADD CONSTRAINT "StockMovementAllocation_stockMovementId_fkey"
  FOREIGN KEY ("stockMovementId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovementAllocation"
  ADD CONSTRAINT "StockMovementAllocation_inventoryLocationBalanceId_fkey"
  FOREIGN KEY ("inventoryLocationBalanceId") REFERENCES "InventoryLocationBalance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockReservation"
  ADD CONSTRAINT "StockReservation_locationBalanceId_fkey"
  FOREIGN KEY ("locationBalanceId") REFERENCES "InventoryLocationBalance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------
-- 5. Row-level consistency checks
-- -----------------------------------------------
ALTER TABLE "InventoryLocationBalance"
  ADD CONSTRAINT "invloc_nonnegative_quantities"
  CHECK ("quantityOnHand" >= 0
     AND "reservedQuantity" >= 0
     AND "reservedQuantity" <= "quantityOnHand");

ALTER TABLE "StockMovementAllocation"
  ADD CONSTRAINT "movement_allocation_nonzero"
  CHECK ("quantity" <> 0);

-- -----------------------------------------------
-- 6. Verify references belong to the same Product/Warehouse
--    (Individual foreign keys alone cannot enforce this.)
-- -----------------------------------------------
CREATE FUNCTION "stockflow_check_location_balance_scope"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_track_batch BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "WarehouseLocation" l
    WHERE l."id" = NEW."locationId"
      AND l."warehouseId" = NEW."warehouseId"
  ) THEN
    RAISE EXCEPTION 'InventoryLocationBalance location does not belong to warehouse'
      USING ERRCODE = '23514';
  END IF;

  SELECT p."trackBatch" INTO v_track_batch
  FROM "Product" p WHERE p."id" = NEW."productId";

  IF v_track_batch AND NEW."batchId" IS NULL THEN
    RAISE EXCEPTION 'Batch-tracked product requires a batchId'
      USING ERRCODE = '23514';
  END IF;

  IF NOT v_track_batch AND NEW."batchId" IS NOT NULL THEN
    RAISE EXCEPTION 'Non-batch product cannot use batchId'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."batchId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ProductBatch" b
    WHERE b."id" = NEW."batchId"
      AND b."productId" = NEW."productId"
      AND b."warehouseId" = NEW."warehouseId"
  ) THEN
    RAISE EXCEPTION 'Batch does not belong to the Product/Warehouse'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "stockflow_location_balance_scope_trg"
BEFORE INSERT OR UPDATE OF "productId", "warehouseId", "locationId", "batchId"
ON "InventoryLocationBalance"
FOR EACH ROW EXECUTE FUNCTION "stockflow_check_location_balance_scope"();

-- Reservation references must match the specific balance row.
-- Existing legacy reservations have NULL locationBalanceId and remain valid.
CREATE FUNCTION "stockflow_check_reservation_location_scope"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."locationBalanceId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "InventoryLocationBalance" b
    WHERE b."id" = NEW."locationBalanceId"
      AND b."productId" = NEW."productId"
      AND b."warehouseId" = NEW."warehouseId"
      AND b."batchId" IS NOT DISTINCT FROM NEW."batchId"
  ) THEN
    RAISE EXCEPTION 'Reservation location balance does not match Product/Warehouse/Batch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "stockflow_reservation_location_scope_trg"
BEFORE INSERT OR UPDATE OF "locationBalanceId", "productId", "warehouseId", "batchId"
ON "StockReservation"
FOR EACH ROW EXECUTE FUNCTION "stockflow_check_reservation_location_scope"();

-- Movement allocation must stay within the same Product/Warehouse.
CREATE FUNCTION "stockflow_check_movement_allocation_scope"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "StockMovement" m
    JOIN "InventoryLocationBalance" b
      ON b."id" = NEW."inventoryLocationBalanceId"
    WHERE m."id" = NEW."stockMovementId"
      AND m."productId" = b."productId"
      AND m."warehouseId" = b."warehouseId"
  ) THEN
    RAISE EXCEPTION 'Movement allocation does not match Product/Warehouse'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "stockflow_movement_allocation_scope_trg"
BEFORE INSERT OR UPDATE OF "stockMovementId", "inventoryLocationBalanceId"
ON "StockMovementAllocation"
FOR EACH ROW EXECUTE FUNCTION "stockflow_check_movement_allocation_scope"();

-- -----------------------------------------------
-- NO BACKFILL HERE: this migration only adds structure.
-- Do not switch API reads/writes to this table before staged reconciliation.
-- -----------------------------------------------
