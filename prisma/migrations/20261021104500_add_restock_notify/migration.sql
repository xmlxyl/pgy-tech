-- CreateTable
CREATE TABLE "RestockNotify" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "variantTitle" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestockNotify_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RestockNotify_shop_email_variantId_key" ON "RestockNotify"("shop", "email", "variantId");

-- CreateIndex
CREATE INDEX "RestockNotify_shop_productId_idx" ON "RestockNotify"("shop", "productId");

-- CreateIndex
CREATE INDEX "RestockNotify_shop_createdAt_idx" ON "RestockNotify"("shop", "createdAt");
