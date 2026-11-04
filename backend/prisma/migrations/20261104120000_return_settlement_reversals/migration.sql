ALTER TABLE "ReturnSettlement"
  ADD COLUMN "isReversal" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reversesSettlementId" UUID;

CREATE UNIQUE INDEX "ReturnSettlement_reversesSettlementId_key"
  ON "ReturnSettlement"("reversesSettlementId");

ALTER TABLE "ReturnSettlement"
  ADD CONSTRAINT "ReturnSettlement_reversesSettlementId_fkey"
  FOREIGN KEY ("reversesSettlementId") REFERENCES "ReturnSettlement"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReturnSettlement"
  ADD CONSTRAINT "ReturnSettlement_reversal_link_check"
  CHECK (("isReversal" = false AND "reversesSettlementId" IS NULL) OR ("isReversal" = true AND "reversesSettlementId" IS NOT NULL));
