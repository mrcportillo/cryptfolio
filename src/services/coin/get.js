export default async function get(id) {
  const coin = await fetch(
    `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`,
    {
      headers: {
        accept: "application/json",
        "accept-language": "en-US,en;q=0.9",
        "x-cg-pro-api-key": process.env.COIN_API_KEY,
      },
    },
  );
  return await coin.json();
}
