import type { CoinMarketItem } from "../coin/types.ts";
import { MAX_PRICE_OBSERVATION_AGE_MS } from "./domain.ts";

/** Public coin quotes only; a process restart simply loses the fallback. */
export function createValuationMarketLoader(
  fetchMarkets: (ids: string[]) => Promise<CoinMarketItem[]>,
) {
  const cache = new Map<string, CoinMarketItem>();
  return async (ids: string[], now = new Date()) => {
    for (const [id, market] of cache) {
      const age = now.getTime() - Date.parse(market.last_updated ?? "");
      if (
        !Number.isFinite(age) ||
        age < 0 ||
        age > MAX_PRICE_OBSERVATION_AGE_MS
      )
        cache.delete(id);
    }
    let markets: CoinMarketItem[] = [];
    let providerFailed = false;
    try {
      markets = await fetchMarkets(ids);
    } catch {
      providerFailed = true;
    }
    for (const market of markets) {
      const age = now.getTime() - Date.parse(market.last_updated ?? "");
      if (
        Number.isFinite(market.current_price) &&
        market.current_price > 0 &&
        age >= 0 &&
        age <= MAX_PRICE_OBSERVATION_AGE_MS
      )
        cache.set(market.id, market);
    }
    while (cache.size > 1000) cache.delete(cache.keys().next().value!);
    const received = new Map(markets.map((market) => [market.id, market]));
    let usedFallback = false;
    const result = [...new Set(ids)].flatMap((id) => {
      const current = received.get(id);
      if (current) return [current];
      const cached = cache.get(id);
      if (!cached) return [];
      usedFallback = true;
      return [cached];
    });
    return { markets: result, providerFailed, usedFallback };
  };
}
