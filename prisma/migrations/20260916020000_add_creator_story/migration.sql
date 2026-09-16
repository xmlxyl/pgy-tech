-- CreateTable
CREATE TABLE "CreatorStory" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "product" TEXT NOT NULL DEFAULT '',
    "orderNumber" TEXT,
    "country" TEXT NOT NULL DEFAULT '',
    "story" TEXT NOT NULL,
    "mediaFileId" TEXT,
    "mediaFileUrl" TEXT,
    "mediaFileName" TEXT,
    "mediaMimeType" TEXT,
    "allowContentUse" BOOLEAN NOT NULL DEFAULT false,
    "agreeRules" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorStory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreatorStory_shop_createdAt_idx" ON "CreatorStory"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "CreatorStory_shop_email_idx" ON "CreatorStory"("shop", "email");
