-- AlterTable
ALTER TABLE "SavedEmail" ADD COLUMN "type" TEXT;

-- CreateIndex
CREATE INDEX "SavedEmail_shop_type_idx" ON "SavedEmail"("shop", "type");
