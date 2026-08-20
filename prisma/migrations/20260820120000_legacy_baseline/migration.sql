-- This is the exact Prisma baseline that predates migration tracking.
--
-- Existing databases must be checked with scripts/portfolio-ledger/preflight.sql,
-- then marked with:
--   prisma migrate resolve --applied 20260820120000_legacy_baseline
-- Never execute this CREATE migration against an existing database.

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAsset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetName" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetArchive" (
    "id" TEXT NOT NULL,
    "userAssetId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserAsset_userId_date_idx" ON "UserAsset"("userId", "date");

-- CreateIndex
CREATE INDEX "UserAsset_assetId_idx" ON "UserAsset"("assetId");

-- CreateIndex
CREATE INDEX "AssetArchive_userAssetId_date_idx" ON "AssetArchive"("userAssetId", "date");

-- AddForeignKey
ALTER TABLE "UserAsset" ADD CONSTRAINT "UserAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetArchive" ADD CONSTRAINT "AssetArchive_userAssetId_fkey" FOREIGN KEY ("userAssetId") REFERENCES "UserAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
