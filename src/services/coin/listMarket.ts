import { request } from "./util";
import type { CoinMarketItem } from "./types";

export default async function listMarket(
  pageSize: number = 20,
  page: number = 1,
): Promise<CoinMarketItem[]> {
  return request<CoinMarketItem[]>(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${pageSize}&page=${page}&sparkline=false&locale=en&price_change_percentage=24h`,
  );
}
