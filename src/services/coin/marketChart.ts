import { request } from "./util";
import type { CoinMarketChart } from "./types";

export default async function marketChart(
  id: string,
  days: number = 1,
): Promise<CoinMarketChart> {
  return request<CoinMarketChart>(
    `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`,
  );
}
