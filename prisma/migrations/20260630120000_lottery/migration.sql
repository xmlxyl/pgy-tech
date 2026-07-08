-- CreateTable
CREATE TABLE "LotteryPrize" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LotteryPrize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotteryEntry" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "prizeSlot" INTEGER NOT NULL,
    "prizeTitle" TEXT NOT NULL,
    "couponCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LotteryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotterySettings" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "emailSubject" TEXT NOT NULL DEFAULT 'Your reward coupon is here!',
    "emailBodyHtml" TEXT NOT NULL DEFAULT '<p>Thanks for subscribing! Use code <strong>{{coupon_code}}</strong> for {{prize_title}}.</p>',
    "emailFrom" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LotterySettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LotteryPrize_shop_idx" ON "LotteryPrize"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "LotteryPrize_shop_slot_key" ON "LotteryPrize"("shop", "slot");

-- CreateIndex
CREATE INDEX "LotteryEntry_shop_idx" ON "LotteryEntry"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "LotteryEntry_shop_email_key" ON "LotteryEntry"("shop", "email");

-- CreateIndex
CREATE UNIQUE INDEX "LotterySettings_shop_key" ON "LotterySettings"("shop");
