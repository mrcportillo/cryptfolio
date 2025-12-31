import { request } from "./util";
import type { CoinListItem } from "./types";

export default async function list(
  pageSize: number = 100,
  page: number = 1,
): Promise<CoinListItem[]> {
  return request<CoinListItem[]>(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${pageSize}&page=${page}&sparkline=false&locale=en`,
  );
}
