import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { databaseDecimalToPlain } from "../portfolio-transactions/decimal.ts";
import { listOwnedTransactionPositions } from "../portfolio-transactions/queries.ts";
import { readLedgerAdoption } from "../portfolio-transactions/adoption.ts";
import { calculateLivePortfolioWorth } from "../portfolio-valuation/live.ts";
import type { createValuationMarketLoader } from "../portfolio-valuation/market-cache.ts";
import {
  allocationDrift,
  boundedDecimal,
  personalTremors,
  validateAllocation,
  validateScenario,
} from "./domain.ts";

async function requireAdoptedOwner(
  client: Pick<PrismaClient, "user">,
  userId: string,
) {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { ledgerAdoptedAt: true },
  });
  if (!user?.ledgerAdoptedAt)
    throw new Error(
      "Adopt the transaction ledger before saving portfolio preferences or scenarios.",
    );
}

export async function readOwnedInsights(
  client: PrismaClient,
  userId: string,
  loadMarkets: ReturnType<typeof createValuationMarketLoader>,
  now = new Date(),
) {
  const catalog = await listOwnedTransactionPositions(client, userId);
  const positions = catalog.positions.filter(
    (position) => position.archivedAt === null,
  );
  const quoted = await loadMarkets(
    [...new Set(positions.map((position) => position.assetId))],
    now,
  );
  const valuation = calculateLivePortfolioWorth(
    positions.map((position) => ({
      assetId: position.assetId,
      amount: position.balance,
      positionId: position.id,
    })),
    quoted.markets,
    { requestedAt: now, providerFailed: quoted.providerFailed },
  );
  if (quoted.usedFallback && valuation.valuationStatus === "COMPLETE")
    valuation.valuationStatus = "STALE";
  const [preference, storedTargets] = catalog.ledgerAdopted
    ? await Promise.all([
        client.portfolioPreference.findUnique({ where: { userId } }),
        client.allocationTarget.findMany({
          where: { userId, position: { archivedAt: null } },
        }),
      ])
    : [null, []];
  const minimumImpactUsd = preference
    ? databaseDecimalToPlain(preference.minimumImpactUsd)
    : "10";
  const targets = storedTargets.map((target) => ({
    userAssetId: target.userAssetId,
    minimumPct: databaseDecimalToPlain(target.minimumPct),
    maximumPct: databaseDecimalToPlain(target.maximumPct),
  }));
  return {
    ledgerAdopted: catalog.ledgerAdopted,
    positions,
    valuation,
    minimumImpactUsd,
    targets,
    drift: allocationDrift(valuation, targets),
    tremors: personalTremors(valuation, quoted.markets, minimumImpactUsd),
  };
}

export async function saveImpactThreshold(
  client: PrismaClient,
  userId: string,
  input: unknown,
) {
  const minimumImpactUsd = boundedDecimal(
    input,
    "Minimum USD impact",
    "0",
    "1000000000000",
  );
  await requireAdoptedOwner(client, userId);
  await client.portfolioPreference.upsert({
    where: { userId },
    create: { userId, minimumImpactUsd },
    update: { minimumImpactUsd },
  });
}

export async function saveAllocationTarget(
  client: PrismaClient,
  userId: string,
  positionId: string,
  minimum: unknown,
  maximum: unknown,
) {
  const range = validateAllocation(minimum, maximum);
  await client.$transaction(async (tx) => {
    await requireAdoptedOwner(tx, userId);
    const position = await tx.userAsset.findFirst({
      where: { id: positionId, userId, archivedAt: null },
      select: { id: true },
    });
    if (!position) throw new Error("That position is unavailable.");
    await tx.allocationTarget.upsert({
      where: { userAssetId_userId: { userAssetId: positionId, userId } },
      create: { userAssetId: positionId, userId, ...range },
      update: range,
    });
  });
}

export async function saveScenario(
  client: PrismaClient,
  userId: string,
  id: string | null,
  name: unknown,
  shocks: unknown,
  creationKey?: string,
) {
  const value = validateScenario(name, shocks);
  if (creationKey && !/^[0-9a-f-]{36}$/i.test(creationKey))
    throw new Error("Invalid scenario creation key.");
  const scenarioId = id || creationKey || randomUUID();
  await client.$transaction(async (tx) => {
    await requireAdoptedOwner(tx, userId);
    const existing =
      id ||
      (creationKey &&
        (await tx.stressScenario.findFirst({
          where: { id: scenarioId, userId },
          select: { id: true },
        })));
    if (existing) {
      const updated = await tx.stressScenario.updateMany({
        where: { id: scenarioId, userId, archivedAt: null },
        data: { name: value.name, updatedAt: new Date() },
      });
      if (updated.count !== 1) throw new Error("That scenario is unavailable.");
      await tx.scenarioShock.deleteMany({ where: { scenarioId, userId } });
    } else {
      await tx.stressScenario.create({
        data: { id: scenarioId, userId, name: value.name },
      });
    }
    await tx.scenarioShock.createMany({
      data: value.shocks.map((shock) => ({ scenarioId, userId, ...shock })),
    });
  });
  return scenarioId;
}

export async function archiveScenario(
  client: PrismaClient,
  userId: string,
  id: string,
) {
  const updated = await client.stressScenario.updateMany({
    where: { id, userId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  if (updated.count !== 1) throw new Error("That scenario is unavailable.");
}

export async function listOwnedScenarios(client: PrismaClient, userId: string) {
  if (!(await readLedgerAdoption(client, userId))) return [];
  const scenarios = await client.stressScenario.findMany({
    where: { userId, archivedAt: null },
    include: { shocks: { where: { userId } } },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
  return scenarios.map((scenario) => ({
    id: scenario.id,
    name: scenario.name,
    shocks: scenario.shocks.map((shock) => ({
      assetId: shock.assetId,
      percent: databaseDecimalToPlain(shock.percent),
    })),
  }));
}
