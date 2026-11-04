CREATE TYPE "WarehouseCapacityUnit" AS ENUM ('ITEM_UNITS', 'PALLET_POSITIONS', 'CUBIC_METERS');

ALTER TABLE "WarehouseLocation"
  ADD COLUMN "capacityUnit" "WarehouseCapacityUnit" NOT NULL DEFAULT 'ITEM_UNITS';
