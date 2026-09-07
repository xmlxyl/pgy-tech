CREATE TABLE "CouponLotterySetting" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "codePrefix" TEXT NOT NULL DEFAULT 'PGY-',
    "prizes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CouponLotterySetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CouponLotteryClaim" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "couponCode" TEXT NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL,
    "minSpend" DECIMAL(12,2) NOT NULL,
    "shopifyDiscountId" TEXT,
    "agreedMarketing" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponLotteryClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CouponLotterySetting_shop_key" ON "CouponLotterySetting"("shop");
CREATE UNIQUE INDEX "CouponLotteryClaim_shop_email_key" ON "CouponLotteryClaim"("shop", "email");
CREATE UNIQUE INDEX "CouponLotteryClaim_shop_couponCode_key" ON "CouponLotteryClaim"("shop", "couponCode");
CREATE INDEX "CouponLotteryClaim_shop_createdAt_idx" ON "CouponLotteryClaim"("shop", "createdAt");
