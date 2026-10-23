-- Sales fulfillment: picking, packing, partial shipment and delivery completion.

ALTER TYPE "SaleStatus" ADD VALUE 'PICKING';
ALTER TYPE "SaleStatus" ADD VALUE 'PACKED';
ALTER TYPE "SaleStatus" ADD VALUE 'PARTIALLY_SHIPPED';
ALTER TYPE "SaleStatus" ADD VALUE 'SHIPPED';

CREATE TYPE "SaleShipmentStatus" AS ENUM ('PICKING', 'PACKED', 'SHIPPED', 'COMPLETED', 'CANCELLED');

CREATE TABLE "SaleShipment" (
  "id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "saleId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL,
  "createdById" UUID NOT NULL,
  "status" "SaleShipmentStatus" NOT NULL DEFAULT 'PICKING',
  "courier" TEXT,
  "trackingNumber" TEXT,
  "shippingAddress" TEXT,
  "pickedAt" TIMESTAMP(3),
  "packedAt" TIMESTAMP(3),
  "shippedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SaleShipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaleShipmentItem" (
  "id" UUID NOT NULL,
  "shipmentId" UUID NOT NULL,
  "saleItemId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "pickedQuantity" INTEGER NOT NULL DEFAULT 0,
  "packedQuantity" INTEGER NOT NULL DEFAULT 0,
  "pickedById" UUID,
  "packedById" UUID,
  "pickedAt" TIMESTAMP(3),
  "packedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SaleShipmentItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sale_shipment_item_quantity_ck" CHECK ("quantity" > 0),
  CONSTRAINT "sale_shipment_item_picked_ck" CHECK ("pickedQuantity" >= 0 AND "pickedQuantity" <= "quantity"),
  CONSTRAINT "sale_shipment_item_packed_ck" CHECK ("packedQuantity" >= 0 AND "packedQuantity" <= "pickedQuantity")
);

CREATE UNIQUE INDEX "SaleShipment_number_key" ON "SaleShipment"("number");
CREATE INDEX "SaleShipment_saleId_status_idx" ON "SaleShipment"("saleId", "status");
CREATE INDEX "SaleShipment_warehouseId_status_createdAt_idx" ON "SaleShipment"("warehouseId", "status", "createdAt");
CREATE INDEX "SaleShipment_createdById_idx" ON "SaleShipment"("createdById");
CREATE UNIQUE INDEX "SaleShipmentItem_shipmentId_saleItemId_key" ON "SaleShipmentItem"("shipmentId", "saleItemId");
CREATE INDEX "SaleShipmentItem_saleItemId_idx" ON "SaleShipmentItem"("saleItemId");
CREATE INDEX "SaleShipmentItem_productId_idx" ON "SaleShipmentItem"("productId");

ALTER TABLE "SaleShipment"
  ADD CONSTRAINT "SaleShipment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleShipment"
  ADD CONSTRAINT "SaleShipment_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleShipment"
  ADD CONSTRAINT "SaleShipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleShipmentItem"
  ADD CONSTRAINT "SaleShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "SaleShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleShipmentItem"
  ADD CONSTRAINT "SaleShipmentItem_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleShipmentItem"
  ADD CONSTRAINT "SaleShipmentItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleShipmentItem"
  ADD CONSTRAINT "SaleShipmentItem_pickedById_fkey" FOREIGN KEY ("pickedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SaleShipmentItem"
  ADD CONSTRAINT "SaleShipmentItem_packedById_fkey" FOREIGN KEY ("packedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
