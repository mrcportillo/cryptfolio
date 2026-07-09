import { assertCoinId, request } from "./util";
import type { CoinMarketChart } from "./types";

export default async function marketChart(
  id: string,
  days: number = 1,
): Promise<CoinMarketChart> {
  const safeId = encodeURIComponent(assertCoinId(id));

  return request<CoinMarketChart>(
    `https://api.coingecko.com/api/v3/coins/${safeId}/market_chart?vs_currency=usd&days=${days}`,
  );
}
