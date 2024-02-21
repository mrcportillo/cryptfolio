export default async function list(pageSize = 100, page = 1) {
  const coinList = await fetch(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${pageSize}&page=${page}&sparkline=false&locale=en`,
  );
  return await coinList.json();
}
