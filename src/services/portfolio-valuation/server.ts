import prisma from "@/services/prisma/client";
import { listMarketByIds } from "@/services/coin/market";
import { createValuationMarketLoader } from "./market-cache";
import { createCoinGeckoSnapshotPriceSource } from "./provider";
import { readDailyReport, readWeeklyReport } from "./reports";
import { readLedgerAdoption } from "../portfolio-transactions/adoption";

export const loadPortfolioMarkets =
  createValuationMarketLoader(listMarketByIds);

export function getDailyReport(userId: string, now = new Date()) {
  return readDailyReport(
    prisma,
    userId,
    now,
    loadPortfolioMarkets,
    createCoinGeckoSnapshotPriceSource(),
  );
}

export async function getWeeklyReport(
  userId: string,
  selection?: string,
  now = new Date(),
) {
  if (!(await readLedgerAdoption(prisma, userId))) return null;
  return readWeeklyReport(
    prisma,
    userId,
    selection,
    now,
    loadPortfolioMarkets,
    createCoinGeckoSnapshotPriceSource(),
  );
}
