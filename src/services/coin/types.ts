export type CoinListItem = {
  id: string;
  name: string;
};

export type CoinMarketData = {
  current_price?: {
    usd?: number;
  };
  price_change_percentage_24h?: number;
  price_change_percentage_7d?: number;
  price_change_percentage_30d?: number;
};

export type CoinDetail = {
  id: string;
  name: string;
  image: {
    large: string;
  };
  market_data?: CoinMarketData;
};

export type CoinMarketItem = {
  id: string;
  name: string;
  symbol: string;
  current_price?: number;
  price_change_percentage_24h?: number;
  market_cap?: number;
};

export type CoinMarketChart = {
  prices: [number, number][];
};
