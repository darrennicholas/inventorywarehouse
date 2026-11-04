CREATE TYPE "ReturnInspectionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FOLLOW_UP');
CREATE TABLE "ReturnInspection" (
  "id" UUID NOT NULL,
  "returnOrderId" UUID NOT NULL,
  "status" "ReturnInspectionStatus" NOT NULL DEFAULT 'PENDING',
  "notes" TEXT,
  "inspectedById" UUID NOT NULL,
  "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReturnInspection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReturnInspection_returnOrderId_fkey" FOREIGN KEY ("returnOrderId") REFERENCES "ReturnOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReturnInspection_inspectedById_fkey" FOREIGN KEY ("inspectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReturnInspection_returnOrderId_key" ON "ReturnInspection"("returnOrderId");
CREATE INDEX "ReturnInspection_status_inspectedAt_idx" ON "ReturnInspection"("status", "inspectedAt");
