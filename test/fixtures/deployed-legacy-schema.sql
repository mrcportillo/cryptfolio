-- Synthetic reconstruction of the logical schema observed on 2026-09-08.
-- No production data or identifiers. Preserve column-order history and gaps.
CREATE TABLE "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE TABLE "UserAsset" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assetName" TEXT NOT NULL,
  CONSTRAINT "UserAsset_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE TABLE "AssetArchive" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userAssetId" TEXT NOT NULL,
  "obsolete_one" TEXT,
  "obsolete_two" TEXT,
  "amount" DOUBLE PRECISION NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssetArchive_userAssetId_fkey" FOREIGN KEY ("userAssetId")
    REFERENCES "UserAsset"("id") ON UPDATE CASCADE ON DELETE RESTRICT
);
ALTER TABLE "AssetArchive" DROP COLUMN "obsolete_one", DROP COLUMN "obsolete_two";
