CREATE TABLE "UserManual" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "productSeries" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserManual_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserManual_shop_productSeries_idx" ON "UserManual"("shop", "productSeries");
CREATE INDEX "UserManual_shop_createdAt_idx" ON "UserManual"("shop", "createdAt");
