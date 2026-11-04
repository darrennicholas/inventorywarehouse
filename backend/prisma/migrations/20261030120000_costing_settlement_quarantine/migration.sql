BEGIN;
ALTER TABLE "InventoryBalance" ADD COLUMN "averageUnitCost" DECIMAL(20,6);
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_average_cost_nonnegative" CHECK ("averageUnitCost" IS NULL OR "averageUnitCost" >= 0);
ALTER TABLE "StockMovement" ADD COLUMN "costMethod" TEXT;
ALTER TABLE "StockMovement" ALTER COLUMN "unitCost" TYPE DECIMAL(20,6);
ALTER TABLE "GoodsReceiptItem" DROP CONSTRAINT "GoodsReceiptItem_positive_quantities";
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_positive_quantities" CHECK ("quantity" >= 0 AND "damagedQuantity" >= 0 AND "quantity" + "damagedQuantity" > 0);
CREATE TYPE "ReturnSettlementKind" AS ENUM ('REFUND', 'CREDIT');
CREATE TYPE "QuarantineAction" AS ENUM ('RELEASE', 'SCRAP', 'RETURN_SUPPLIER');
CREATE TYPE "QuarantineDecisionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TABLE "ReturnSettlement" (
 "id" UUID PRIMARY KEY, "returnOrderId" UUID NOT NULL REFERENCES "ReturnOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "kind" "ReturnSettlementKind" NOT NULL, "amount" DECIMAL(14,2) NOT NULL CHECK ("amount" > 0),
 "reference" TEXT NOT NULL, "notes" TEXT NOT NULL, "createdById" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ReturnSettlement_returnOrderId_createdAt_idx" ON "ReturnSettlement"("returnOrderId", "createdAt");
CREATE TABLE "CreditApplication" (
 "id" UUID PRIMARY KEY, "settlementId" UUID NOT NULL REFERENCES "ReturnSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "purchaseOrderId" UUID REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "saleId" UUID REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "amount" DECIMAL(14,2) NOT NULL CHECK ("amount" > 0),
 "createdById" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CreditApplication_exactly_one_target" CHECK (num_nonnulls("purchaseOrderId", "saleId") = 1)
);
CREATE INDEX "CreditApplication_settlementId_idx" ON "CreditApplication"("settlementId");
CREATE INDEX "CreditApplication_purchaseOrderId_idx" ON "CreditApplication"("purchaseOrderId");
CREATE INDEX "CreditApplication_saleId_idx" ON "CreditApplication"("saleId");
CREATE TABLE "QuarantineDecision" (
 "id" UUID PRIMARY KEY,
 "locationBalanceId" UUID NOT NULL REFERENCES "InventoryLocationBalance"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "destinationLocationId" UUID REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "purchaseOrderItemId" UUID REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "returnOrderId" UUID REFERENCES "ReturnOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "quantity" INTEGER NOT NULL CHECK ("quantity" > 0), "action" "QuarantineAction" NOT NULL,
 "status" "QuarantineDecisionStatus" NOT NULL DEFAULT 'PENDING', "reason" TEXT NOT NULL, "reviewNotes" TEXT,
 "createdById" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "approvedById" UUID REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reviewedAt" TIMESTAMP(3),
 CONSTRAINT "QuarantineDecision_different_reviewer" CHECK ("approvedById" IS NULL OR "approvedById" <> "createdById")
);
CREATE INDEX "QuarantineDecision_locationBalanceId_status_idx" ON "QuarantineDecision"("locationBalanceId", "status");
CREATE INDEX "QuarantineDecision_purchaseOrderItemId_status_idx" ON "QuarantineDecision"("purchaseOrderItemId", "status");
ALTER TABLE "QuarantineDecision" ADD CONSTRAINT "QuarantineDecision_action_links" CHECK (
 ("action" = 'RELEASE' AND "destinationLocationId" IS NOT NULL AND "purchaseOrderItemId" IS NULL) OR
 ("action" = 'RETURN_SUPPLIER' AND "purchaseOrderItemId" IS NOT NULL AND "destinationLocationId" IS NULL) OR
 ("action" = 'SCRAP' AND "destinationLocationId" IS NULL AND "purchaseOrderItemId" IS NULL)
);
ALTER TABLE "QuarantineDecision" ADD CONSTRAINT "QuarantineDecision_review_fields" CHECK (
 ("status" = 'PENDING' AND "approvedById" IS NULL AND "reviewedAt" IS NULL) OR
 ("status" <> 'PENDING' AND "approvedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewNotes" IS NOT NULL)
);
COMMIT;
