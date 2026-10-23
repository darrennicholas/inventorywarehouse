-- Step 6: immutable business audit trail (separate from StockMovement)
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeData" JSONB,
    "afterData" JSONB,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 7: warehouse-specific physical count sessions
CREATE TYPE "StockTakeStatus" AS ENUM ('DRAFT', 'COUNTING', 'SUBMITTED', 'APPROVED', 'CANCELLED');
CREATE TABLE "StockTakeSession" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "warehouseId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "approvedById" UUID,
    "status" "StockTakeStatus" NOT NULL DEFAULT 'DRAFT',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StockTakeSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StockTakeSession_number_key" ON "StockTakeSession"("number");
CREATE INDEX "StockTakeSession_warehouseId_status_idx" ON "StockTakeSession"("warehouseId", "status");
CREATE INDEX "StockTakeSession_createdById_idx" ON "StockTakeSession"("createdById");
CREATE INDEX "StockTakeSession_startedAt_idx" ON "StockTakeSession"("startedAt");
ALTER TABLE "StockTakeSession" ADD CONSTRAINT "StockTakeSession_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockTakeSession" ADD CONSTRAINT "StockTakeSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockTakeSession" ADD CONSTRAINT "StockTakeSession_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "StockTakeLine" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "systemQuantity" INTEGER NOT NULL,
    "physicalQuantity" INTEGER,
    "variance" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "countedAt" TIMESTAMP(3),
    CONSTRAINT "StockTakeLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StockTakeLine_sessionId_productId_key" ON "StockTakeLine"("sessionId", "productId");
CREATE INDEX "StockTakeLine_productId_idx" ON "StockTakeLine"("productId");
ALTER TABLE "StockTakeLine" ADD CONSTRAINT "StockTakeLine_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StockTakeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockTakeLine" ADD CONSTRAINT "StockTakeLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
