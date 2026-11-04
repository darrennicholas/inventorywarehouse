CREATE TABLE "ReturnItemInspection" (
  "id" UUID NOT NULL,
  "returnOrderItemId" UUID NOT NULL,
  "condition" "ReturnCondition" NOT NULL,
  "recommendedDisposition" "ReturnDisposition" NOT NULL,
  "notes" TEXT NOT NULL,
  "inspectedById" UUID NOT NULL,
  "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReturnItemInspection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReturnItemInspection_item_fkey" FOREIGN KEY ("returnOrderItemId") REFERENCES "ReturnOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReturnItemInspection_user_fkey" FOREIGN KEY ("inspectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReturnItemInspection_returnOrderItemId_key" ON "ReturnItemInspection"("returnOrderItemId");
