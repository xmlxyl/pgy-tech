CREATE TABLE "LuckyWheelSetting" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "codePrefix" TEXT NOT NULL DEFAULT 'LW-',
    "codeStartsAt" TIMESTAMP(3) NOT NULL,
    "codeEndsAt" TIMESTAMP(3) NOT NULL,
    "prizes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LuckyWheelSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LuckyWheelClaim" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "couponCode" TEXT NOT NULL,
    "percentOff" DECIMAL(5,2) NOT NULL,
    "label" TEXT NOT NULL,
    "sectorIndex" INTEGER NOT NULL,
    "shopifyDiscountId" TEXT,
    "agreedMarketing" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LuckyWheelClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LuckyWheelSetting_shop_key" ON "LuckyWheelSetting"("shop");
CREATE UNIQUE INDEX "LuckyWheelClaim_shop_email_key" ON "LuckyWheelClaim"("shop", "email");
CREATE UNIQUE INDEX "LuckyWheelClaim_shop_couponCode_key" ON "LuckyWheelClaim"("shop", "couponCode");
CREATE INDEX "LuckyWheelClaim_shop_createdAt_idx" ON "LuckyWheelClaim"("shop", "createdAt");
