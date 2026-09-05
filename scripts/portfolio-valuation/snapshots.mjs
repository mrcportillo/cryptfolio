import { PrismaClient } from "@prisma/client";
import {
  adoptionSnapshotTarget,
  capturePortfolioSnapshot,
  dailySnapshotTarget,
} from "../../src/services/portfolio-valuation/service.ts";
import { createPostgresSnapshotStore } from "../../src/services/portfolio-valuation/postgres.ts";
import {
  assertSnapshotPriceConfiguration,
  createCoinGeckoSnapshotPriceSource,
} from "../../src/services/portfolio-valuation/provider.ts";
import { parseSnapshotArguments, snapshotHelp } from "./snapshots-lib.mjs";

function resultForOutput(result, apply) {
  return {
    mode: apply ? "apply" : "dry-run",
    target: {
      kind: result.draft.target.kind,
      reportingDate: result.draft.target.reportingDate,
      cutoffAt: result.draft.target.cutoffAt.toISOString(),
    },
    ledgerRevision: result.draft.ledgerRevision.toString(),
    lifecycleStatus: result.draft.lifecycleStatus,
    valuationStatus: result.draft.valuationStatus,
    reconciliationStatus: result.draft.reconciliationStatus,
    totalValueUsd: result.draft.totalValueUsd,
    knownValueUsd: result.draft.knownValueUsd,
    pricedPositions: result.draft.positions.filter(
      (position) => position.priceUsd != null,
    ).length,
    missingPositions: result.draft.positions.filter(
      (position) => position.priceUsd == null,
    ).length,
    published: result.published,
  };
}

async function main() {
  const options = parseSnapshotArguments(process.argv.slice(2));
  if (options.help) {
    console.log(snapshotHelp());
    return;
  }
  if (!process.env.POSTGRES_PRISMA_URL) {
    throw new Error("POSTGRES_PRISMA_URL is required.");
  }
  assertSnapshotPriceConfiguration();

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { id: options.userId },
      select: { ledgerAdoptedAt: true },
    });
    if (!user?.ledgerAdoptedAt) {
      throw new Error("The selected user does not have an adopted ledger.");
    }
    const target = options.adoptionBaseline
      ? adoptionSnapshotTarget(user.ledgerAdoptedAt)
      : dailySnapshotTarget(options.reportingDate);
    const provenance = options.repair
      ? "REPAIR"
      : options.adoptionBaseline
        ? "ADOPTION_BASELINE"
        : "MANUAL";
    const result = await capturePortfolioSnapshot(
      createPostgresSnapshotStore(prisma),
      createCoinGeckoSnapshotPriceSource(),
      {
        userId: options.userId,
        target,
        provenance,
        actor: "portfolio-snapshot-cli",
        reason: options.reason,
        apply: options.apply,
      },
    );
    console.log(
      JSON.stringify(resultForOutput(result, options.apply), null, 2),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Snapshot command failed.",
  );
  process.exitCode = 1;
});
