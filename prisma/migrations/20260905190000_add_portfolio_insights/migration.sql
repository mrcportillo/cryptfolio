-- CreateTable
CREATE TABLE "PortfolioPreference" (
    "userId" TEXT NOT NULL,
    "minimumImpactUsd" DECIMAL(16,2) NOT NULL DEFAULT 10,

    CONSTRAINT "PortfolioPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AllocationTarget" (
    "userAssetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "minimumPct" DECIMAL(5,2) NOT NULL,
    "maximumPct" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "AllocationTarget_pkey" PRIMARY KEY ("userAssetId","userId")
);

-- CreateTable
CREATE TABLE "StressScenario" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StressScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioShock" (
    "scenarioId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetId" VARCHAR(160) NOT NULL,
    "percent" DECIMAL(7,2) NOT NULL,

    CONSTRAINT "ScenarioShock_pkey" PRIMARY KEY ("scenarioId","assetId")
);

-- CreateIndex
CREATE INDEX "AllocationTarget_userId_idx" ON "AllocationTarget"("userId");

-- CreateIndex
CREATE INDEX "StressScenario_userId_archivedAt_updatedAt_idx" ON "StressScenario"("userId", "archivedAt", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StressScenario_id_userId_key" ON "StressScenario"("id", "userId");

-- CreateIndex
CREATE INDEX "ScenarioShock_userId_idx" ON "ScenarioShock"("userId");

-- AddForeignKey
ALTER TABLE "PortfolioPreference" ADD CONSTRAINT "PortfolioPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationTarget" ADD CONSTRAINT "AllocationTarget_userAssetId_userId_fkey" FOREIGN KEY ("userAssetId", "userId") REFERENCES "UserAsset"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StressScenario" ADD CONSTRAINT "StressScenario_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioShock" ADD CONSTRAINT "ScenarioShock_scenarioId_userId_fkey" FOREIGN KEY ("scenarioId", "userId") REFERENCES "StressScenario"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PortfolioPreference" ADD CONSTRAINT "PortfolioPreference_impact_range_check"
CHECK ("minimumImpactUsd" BETWEEN 0 AND 1000000000000);
ALTER TABLE "AllocationTarget" ADD CONSTRAINT "AllocationTarget_range_check"
CHECK ("minimumPct" BETWEEN 0 AND 100 AND "maximumPct" BETWEEN "minimumPct" AND 100);
ALTER TABLE "StressScenario" ADD CONSTRAINT "StressScenario_name_check"
CHECK (length(btrim("name")) BETWEEN 1 AND 80);
ALTER TABLE "StressScenario" ADD CONSTRAINT "StressScenario_finite_dates_check"
CHECK (isfinite("updatedAt") AND ("archivedAt" IS NULL OR isfinite("archivedAt")));
ALTER TABLE "ScenarioShock" ADD CONSTRAINT "ScenarioShock_range_check"
CHECK ("percent" BETWEEN -100 AND 1000);
ALTER TABLE "ScenarioShock" ADD CONSTRAINT "ScenarioShock_coin_check"
CHECK ("assetId" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
