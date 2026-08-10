CREATE TABLE "PriceChangeTask" (
  "id" SERIAL NOT NULL,
  "shop" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Pending',
  "scheduledChangeAt" TIMESTAMP(3) NOT NULL,
  "scheduledRestoreAt" TIMESTAMP(3) NOT NULL,
  "fileName" TEXT NOT NULL,
  "totalCount" INTEGER NOT NULL DEFAULT 0,
  "successCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PriceChangeTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriceChangeTaskItem" (
  "id" SERIAL NOT NULL,
  "taskId" INTEGER NOT NULL,
  "sku" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "originalPrice" DECIMAL(12,2) NOT NULL,
  "targetPrice" DECIMAL(12,2) NOT NULL,
  "changeStatus" TEXT NOT NULL DEFAULT 'Pending',
  "restoreStatus" TEXT NOT NULL DEFAULT 'Pending',
  "errorMessage" TEXT,
  "changedAt" TIMESTAMP(3),
  "restoredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PriceChangeTaskItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PriceChangeTask_shop_status_idx" ON "PriceChangeTask"("shop", "status");
CREATE INDEX "PriceChangeTask_scheduledChangeAt_idx" ON "PriceChangeTask"("scheduledChangeAt");
CREATE INDEX "PriceChangeTask_scheduledRestoreAt_idx" ON "PriceChangeTask"("scheduledRestoreAt");
CREATE INDEX "PriceChangeTaskItem_taskId_idx" ON "PriceChangeTaskItem"("taskId");
CREATE INDEX "PriceChangeTaskItem_sku_idx" ON "PriceChangeTaskItem"("sku");
CREATE UNIQUE INDEX "PriceChangeTaskItem_taskId_sku_key" ON "PriceChangeTaskItem"("taskId", "sku");

ALTER TABLE "PriceChangeTaskItem"
  ADD CONSTRAINT "PriceChangeTaskItem_taskId_fkey"
  FOREIGN KEY ("taskId")
  REFERENCES "PriceChangeTask"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
