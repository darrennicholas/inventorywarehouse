-- Support deterministic newest-first audit paging and product/warehouse movement history.
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_id_idx"
  ON "AuditLog" ("createdAt", "id");

CREATE INDEX IF NOT EXISTS "StockMovement_productId_warehouseId_occurredAt_id_idx"
  ON "StockMovement" ("productId", "warehouseId", "occurredAt", "id");
