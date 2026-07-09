import { request, assertCoinId } from "./util";
import type { CoinDetail } from "./types";

export default async function get(id: string): Promise<CoinDetail> {
  const safeId = encodeURIComponent(assertCoinId(id));

  return request<CoinDetail>(
    `https://api.coingecko.com/api/v3/coins/${safeId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`,
  );
}
