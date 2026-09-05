import prisma from "@/services/prisma/client";
import { createPortfolioSnapshotCronHandler } from "@/services/portfolio-valuation/cron-handler";
import {
  assertSnapshotPriceConfiguration,
  createCoinGeckoSnapshotPriceSource,
} from "@/services/portfolio-valuation/provider";
import { createPostgresPortfolioSnapshotScheduler } from "@/services/portfolio-valuation/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = createPortfolioSnapshotCronHandler({
  configuredSecret: process.env.CRON_SECRET,
  async run(now) {
    assertSnapshotPriceConfiguration();
    return createPostgresPortfolioSnapshotScheduler(
      prisma,
      createCoinGeckoSnapshotPriceSource(),
    )(now);
  },
  logError(error) {
    const safeName = error instanceof Error ? error.name : "UnknownError";
    console.error("Portfolio snapshot cron failed", { error: safeName });
  },
});
