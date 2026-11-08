ALTER TABLE "WarehouseLocation" ADD COLUMN "enforceCapacity" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_enforced_capacity_valid" CHECK (NOT "enforceCapacity" OR ("capacity" IS NOT NULL AND "capacity" > 0 AND "capacityUnit" = 'ITEM_UNITS'));
