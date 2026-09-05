import { normalizeFiniteNumber } from "../portfolio-transactions/decimal.ts";
import type { CoinMarketItem } from "../coin/types.ts";
import { calculateLiveValuation, type LiveValuation } from "./domain.ts";

export function calculateLivePortfolioWorth(
  holdings: readonly { assetId: string; amount: string; positionId?: string }[],
  markets: readonly CoinMarketItem[],
  options: { requestedAt?: Date; providerFailed?: boolean } = {},
): LiveValuation {
  const requestedAt = options.requestedAt ?? new Date();
  const marketById = new Map(markets.map((market) => [market.id, market]));
  return calculateLiveValuation(
    holdings.map((holding) => {
      const market = marketById.get(holding.assetId);
      const observedAt = market?.last_updated
        ? new Date(market.last_updated)
        : null;
      const price = market?.current_price;
      const validObservation =
        typeof price === "number" &&
        Number.isFinite(price) &&
        price > 0 &&
        observedAt != null &&
        !Number.isNaN(observedAt.getTime());
      return {
        positionId: holding.positionId ?? holding.assetId,
        assetId: holding.assetId,
        quantity: holding.amount,
        priceUsd: validObservation ? normalizeFiniteNumber(price) : null,
        priceObservedAt: validObservation ? observedAt : null,
        missingReason: validObservation
          ? null
          : options.providerFailed
            ? "PROVIDER_UNAVAILABLE"
            : market
              ? "INVALID_RESPONSE"
              : "NO_ACCEPTABLE_OBSERVATION",
      };
    }),
    requestedAt,
  );
}
