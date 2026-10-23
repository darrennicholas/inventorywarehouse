-- Database-level invariants for catalog, stock, relocation, and approval ranges.

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_stock_range_check"
  CHECK ("minStock" >= 0 AND ("maxStock" IS NULL OR "maxStock" >= "minStock"));

ALTER TABLE "InventoryBalance"
  ADD CONSTRAINT "InventoryBalance_nonnegative_check"
  CHECK ("quantityOnHand" >= 0 AND "reservedQuantity" >= 0 AND "reservedQuantity" <= "quantityOnHand");

ALTER TABLE "InventoryLocationBalance"
  ADD CONSTRAINT "InventoryLocationBalance_nonnegative_check"
  CHECK ("quantityOnHand" >= 0 AND "reservedQuantity" >= 0 AND "reservedQuantity" <= "quantityOnHand");

ALTER TABLE "ProductBatch"
  ADD CONSTRAINT "ProductBatch_nonnegative_check"
  CHECK ("quantityOnHand" >= 0 AND "reservedQuantity" >= 0 AND "reservedQuantity" <= "quantityOnHand");

ALTER TABLE "StockReservation"
  ADD CONSTRAINT "StockReservation_positive_quantity_check"
  CHECK ("quantity" > 0);

ALTER TABLE "StockRelocation"
  ADD CONSTRAINT "StockRelocation_distinct_locations_check"
  CHECK ("fromLocationId" <> "toLocationId");

ALTER TABLE "ApprovalPolicy"
  ADD CONSTRAINT "ApprovalPolicy_amount_range_check"
  CHECK ("minimumAmount" >= 0 AND ("maximumAmount" IS NULL OR "maximumAmount" >= "minimumAmount"));

CREATE OR REPLACE FUNCTION prevent_approval_policy_overlap()
RETURNS trigger AS $$
BEGIN
  IF NEW."isActive" AND EXISTS (
    SELECT 1
    FROM "ApprovalPolicy" existing
    WHERE existing."id" <> NEW."id"
      AND existing."subject" = NEW."subject"
      AND existing."isActive" = true
      AND (NEW."maximumAmount" IS NULL OR existing."minimumAmount" <= NEW."maximumAmount")
      AND (existing."maximumAmount" IS NULL OR NEW."minimumAmount" <= existing."maximumAmount")
  ) THEN
    RAISE EXCEPTION 'Active approval policy amount ranges cannot overlap for subject %', NEW."subject"
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ApprovalPolicy_prevent_overlap"
BEFORE INSERT OR UPDATE OF "subject", "minimumAmount", "maximumAmount", "isActive"
ON "ApprovalPolicy"
FOR EACH ROW EXECUTE FUNCTION prevent_approval_policy_overlap();
