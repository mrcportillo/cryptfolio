import { request } from "./util";

export default async function get(id) {
  return request(
    `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`,
  );
}
