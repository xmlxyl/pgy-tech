-- AlterTable
ALTER TABLE "PriceChangeTaskItem" ADD COLUMN "productTitle" TEXT NOT NULL DEFAULT '';

-- DropIndex
DROP INDEX "PriceChangeTaskItem_taskId_sku_key";

-- CreateIndex
CREATE UNIQUE INDEX "PriceChangeTaskItem_taskId_variantId_key" ON "PriceChangeTaskItem"("taskId", "variantId");
