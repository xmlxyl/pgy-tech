DROP INDEX IF EXISTS "PriceChangeTask_scheduledChangeAt_idx";
DROP INDEX IF EXISTS "PriceChangeTask_scheduledRestoreAt_idx";

ALTER TABLE "PriceChangeTask" DROP COLUMN IF EXISTS "scheduledChangeAt";
ALTER TABLE "PriceChangeTask" DROP COLUMN IF EXISTS "scheduledRestoreAt";
