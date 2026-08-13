CREATE TABLE "MysteryBoxSetting" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "minOrderAmount" DECIMAL(12,2) NOT NULL DEFAULT 149,
    "webhookUrl" TEXT,
    "usRules" JSONB NOT NULL,
    "intlRules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MysteryBoxSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MysteryBoxDraw" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT,
    "customerId" TEXT,
    "region" TEXT NOT NULL,
    "prizeType" TEXT NOT NULL,
    "prizeSku" TEXT,
    "prizeTitle" TEXT,
    "orderTotal" DECIMAL(12,2) NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MysteryBoxDraw_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MysteryBoxSetting_shop_key" ON "MysteryBoxSetting"("shop");
CREATE UNIQUE INDEX "MysteryBoxDraw_shop_orderId_key" ON "MysteryBoxDraw"("shop", "orderId");
CREATE INDEX "MysteryBoxDraw_shop_customerId_idx" ON "MysteryBoxDraw"("shop", "customerId");
