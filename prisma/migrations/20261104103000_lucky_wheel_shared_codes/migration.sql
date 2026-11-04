DROP INDEX IF EXISTS "LuckyWheelClaim_shop_couponCode_key";

CREATE INDEX IF NOT EXISTS "LuckyWheelClaim_shop_couponCode_idx" ON "LuckyWheelClaim"("shop", "couponCode");
