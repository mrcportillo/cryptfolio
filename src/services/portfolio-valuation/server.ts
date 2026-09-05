import prisma from "@/services/prisma/client";
import { listMarketByIds } from "@/services/coin/market";
import { createValuationMarketLoader } from "./market-cache";
import { createCoinGeckoSnapshotPriceSource } from "./provider";
import { readDailyReport, readWeeklyReport } from "./reports";

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

export function getWeeklyReport(
  userId: string,
  selection?: string,
  now = new Date(),
) {
  return readWeeklyReport(
    prisma,
    userId,
    selection,
    now,
    loadPortfolioMarkets,
    createCoinGeckoSnapshotPriceSource(),
  );
}
