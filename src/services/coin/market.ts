import type { CoinMarketItem } from "./types";
import { request } from "./util";

export async function listMarketByIds(
  ids: string[],
): Promise<CoinMarketItem[]> {
  const uniqueIds = Array.from(new Set(ids)).sort();

  if (uniqueIds.length === 0) {
    return [];
  }

  const params = new URLSearchParams({
    vs_currency: "usd",
    ids: uniqueIds.join(","),
    order: "market_cap_desc",
    per_page: String(Math.min(uniqueIds.length, 250)),
    page: "1",
    sparkline: "false",
    locale: "en",
    price_change_percentage: "24h",
  });

  return request<CoinMarketItem[]>(
    `https://api.coingecko.com/api/v3/coins/markets?${params.toString()}`,
  );
}
