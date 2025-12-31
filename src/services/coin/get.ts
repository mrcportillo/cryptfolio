import { request } from "./util";
import type { CoinDetail } from "./types";

export default async function get(id: string): Promise<CoinDetail> {
  return request<CoinDetail>(
    `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`,
  );
}
