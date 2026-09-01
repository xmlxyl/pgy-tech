ALTER TABLE "UserManual" ADD COLUMN "title" TEXT NOT NULL DEFAULT '';
UPDATE "UserManual" SET "title" = "fileName" WHERE "title" = '';
