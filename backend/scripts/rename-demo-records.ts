import "dotenv/config";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) throw new Error("Perubahan ini hanya boleh dijalankan pada database lokal.");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const documents = [
  ["PurchaseOrder", "PO", "notes"], ["Sale", "SALE", "notes"], ["SaleShipment", "SHP", null],
  ["StockAdjustment", "ADJ", "reason"], ["StockTransfer", "TRF", "notes"], ["Expense", "EXP", null],
  ["ReturnOrder", "RET", "reason"], ["GoodsReceipt", "GR", "notes"], ["StockTakeSession", "OPN", "notes"],
  ["StockRelocation", "REL", "reason"], ["Payment", "PAY", "notes"],
] as const;
const counts: Record<string, number> = {};
try {
  await client.connect();
  await client.query("BEGIN");
  for (const [table, kind, description] of documents) {
    const pattern = `^SEED-${kind}-20261[01]-[0-9]{3}$`;
    const existing = await client.query(`SELECT old."number" FROM "${table}" old JOIN "${table}" newer ON newer."number" = regexp_replace(old."number", '^SEED-', 'SF-') WHERE old."number" ~ $1 LIMIT 1`, [pattern]);
    if (existing.rowCount) throw new Error(`Nomor baru untuk ${existing.rows[0].number} sudah ada; tidak ada perubahan yang disimpan.`);
    const noteUpdate = description ? `, "${description}" = CASE WHEN "${description}" LIKE 'Seed: %' THEN 'Contoh: ' || substring("${description}" FROM 7) WHEN "${description}" = 'Seed goods receipt' THEN 'Penerimaan barang pembelian' ELSE "${description}" END` : "";
    const extra = table === "SaleShipment" ? `, "trackingNumber" = regexp_replace("trackingNumber", '^SEED-DEMO-', 'SF-DEMO-')` : table === "Payment" ? `, "referenceNo" = regexp_replace("referenceNo", '^SEED-REF-', 'SF-REF-')` : "";
    const result = await client.query(`UPDATE "${table}" SET "number" = regexp_replace("number", '^SEED-', 'SF-')${noteUpdate}${extra} WHERE "number" ~ $1`, [pattern]);
    counts[table] = result.rowCount ?? 0;
  }
  const batchCollision = await client.query(`SELECT b."batchNumber" FROM "ProductBatch" b JOIN "Product" p ON p.id=b."productId" JOIN "Warehouse" w ON w.id=b."warehouseId" JOIN "ProductBatch" n ON n."productId"=b."productId" AND n."warehouseId"=b."warehouseId" AND n."batchNumber"=regexp_replace(b."batchNumber", '^SEED-', 'SF-') WHERE p.sku='CB-UGR-USBC' AND w.code='WH-JKT' AND b."batchNumber" ~ '^SEED-BATCH-202611-0(0[1-9]|10)$' LIMIT 1`);
  if (batchCollision.rowCount) throw new Error(`Nomor baru untuk ${batchCollision.rows[0].batchNumber} sudah ada; tidak ada perubahan yang disimpan.`);
  const batches = await client.query(`UPDATE "ProductBatch" b SET "batchNumber"=regexp_replace(b."batchNumber", '^SEED-', 'SF-') FROM "Product" p, "Warehouse" w WHERE b."productId"=p.id AND b."warehouseId"=w.id AND p.sku='CB-UGR-USBC' AND w.code='WH-JKT' AND b."batchNumber" ~ '^SEED-BATCH-202611-0(0[1-9]|10)$'`);
  counts.ProductBatch = batches.rowCount ?? 0;
  await client.query(`UPDATE "StockMovement" SET note = 'Contoh: ' || substring(note FROM 7) WHERE note IN ('Seed: penerimaan PO perangkat','Seed: pengiriman penjualan','Seed: hasil stock opname','Seed: transfer ke Bandung','Seed: transfer dari Jakarta') AND ("purchaseOrderId" IN (SELECT id FROM "PurchaseOrder" WHERE number LIKE 'SF-PO-202610-%') OR "saleId" IN (SELECT id FROM "Sale" WHERE number LIKE 'SF-SALE-202610-%') OR "adjustmentId" IN (SELECT id FROM "StockAdjustment" WHERE number LIKE 'SF-ADJ-202610-%') OR "transferId" IN (SELECT id FROM "StockTransfer" WHERE number LIKE 'SF-TRF-202610-%'))`);
  await client.query(`UPDATE "ReturnInspection" SET notes = 'Contoh: ' || substring(notes FROM 7) WHERE notes LIKE 'Seed: status inspeksi %' AND "returnOrderId" IN (SELECT id FROM "ReturnOrder" WHERE number LIKE 'SF-RET-202611-%')`);
  await client.query(`UPDATE "StockReservation" SET "releaseReason" = 'Contoh: ' || substring("releaseReason" FROM 7) WHERE "releaseReason" IN ('Seed: pesanan dibatalkan','Seed: reservasi tidak dilanjutkan') AND "saleId" IN (SELECT id FROM "Sale" WHERE number LIKE 'SF-SALE-20261%')`);
  await client.query(`UPDATE "QuarantineDecision" SET reason = 'Contoh: ' || substring(reason FROM 7), "reviewNotes" = CASE WHEN "reviewNotes" LIKE 'Seed: review %' THEN 'Contoh: ' || substring("reviewNotes" FROM 7) ELSE "reviewNotes" END WHERE reason ~ '^Seed: contoh keputusan karantina ([1-9]|10)$' AND "locationBalanceId" IN (SELECT b.id FROM "InventoryLocationBalance" b JOIN "Product" p ON p.id=b."productId" JOIN "WarehouseLocation" l ON l.id=b."locationId" WHERE p.sku='GLV-SAFE-01' AND l.code='JKT-Q01')`);
  await client.query(`UPDATE "AuditLog" SET action = 'VIEW' WHERE action = 'SEED:VIEW' AND entity = 'DemoRecord' AND "entityId" ~ '^DEMO-0(0[1-9]|10)$'`);
  for (const [table, kind] of documents) {
    await client.query(`UPDATE "Notification" n SET message = replace(n.message, 'SEED-' || substring(d.number FROM 4), d.number) FROM "${table}" d WHERE n.entity = $1 AND n."entityId" = d.id::text AND d.number ~ $2 AND n.message LIKE '%' || 'SEED-' || substring(d.number FROM 4) || '%'`, [table, `^SF-${kind}-20261[01]-[0-9]{3}$`]);
  }
  await client.query(`UPDATE "Notification" SET message = regexp_replace(message, '^SEED-', 'SF-') WHERE message ~ '^SEED-(PO|SALE|SHP|ADJ|TRF|EXP|RET|GR|OPN|REL|PAY)-20261[01]-[0-9]{3} '`);
  await client.query("COMMIT");
  console.log(JSON.stringify(counts, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally { await client.end(); }
