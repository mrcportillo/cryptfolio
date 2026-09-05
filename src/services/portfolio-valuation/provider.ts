import { assertCoinId } from "../coin/util.ts";
import {
  MAX_PRICE_OBSERVATION_AGE_MS,
  selectPriceObservation,
} from "./domain.ts";
import type {
  SnapshotPriceResolution,
  SnapshotPriceSource,
} from "./service.ts";

const DEMO_API_ROOT = "https://api.coingecko.com/api/v3";
const PRO_API_ROOT = "https://pro-api.coingecko.com/api/v3";
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 3;
const MAX_RANGE_MS = 3 * 24 * 60 * 60 * 1_000;

export type HistoricalPriceObservation = {
  observedAt: Date;
  priceUsd: number;
};

export type CoinPriceFailureReason =
  | "MISSING_CREDENTIAL"
  | "RATE_LIMITED"
  | "UNKNOWN_COIN"
  | "UNAVAILABLE"
  | "INVALID_RESPONSE";

export class CoinPriceProviderError extends Error {
  readonly reason: CoinPriceFailureReason;
  readonly status: number | null;

  constructor(
    message: string,
    reason: CoinPriceFailureReason,
    status: number | null = null,
  ) {
    super(message);
    this.name = "CoinPriceProviderError";
    this.reason = reason;
    this.status = status;
  }
}

type FetchLike = typeof fetch;

export type HistoricalPriceProviderOptions = {
  fetch?: FetchLike;
  wait?: (milliseconds: number) => Promise<void>;
  apiKey?: string;
  apiPlan?: "demo" | "pro";
  requireCredential?: boolean;
};

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export function assertSnapshotPriceConfiguration(
  options: HistoricalPriceProviderOptions = {},
) {
  const configuration = providerConfiguration(options);
  if ((options.requireCredential ?? true) && !configuration.apiKey) {
    throw new CoinPriceProviderError(
      "CoinGecko credentials are not configured for valuation snapshots.",
      "MISSING_CREDENTIAL",
    );
  }
}

function providerConfiguration(options: HistoricalPriceProviderOptions): {
  root: string;
  headerName: string;
  apiKey: string | undefined;
} {
  const apiPlan =
    options.apiPlan ?? (process.env.COIN_API_PLAN === "pro" ? "pro" : "demo");
  return {
    root: apiPlan === "pro" ? PRO_API_ROOT : DEMO_API_ROOT,
    headerName: apiPlan === "pro" ? "x-cg-pro-api-key" : "x-cg-demo-api-key",
    apiKey: options.apiKey ?? process.env.COIN_API_KEY,
  };
}

function classifyStatus(status: number): CoinPriceFailureReason {
  if (status === 404) return "UNKNOWN_COIN";
  if (status === 429) return "RATE_LIMITED";
  return status >= 500 ? "UNAVAILABLE" : "INVALID_RESPONSE";
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, 2_000);
  }
  return 250 * 2 ** attempt;
}

function parseObservations(value: unknown): HistoricalPriceObservation[] {
  if (!value || typeof value !== "object" || !("prices" in value)) {
    throw new CoinPriceProviderError(
      "CoinGecko returned an invalid historical-price response.",
      "INVALID_RESPONSE",
    );
  }
  const prices = (value as { prices?: unknown }).prices;
  if (!Array.isArray(prices)) {
    throw new CoinPriceProviderError(
      "CoinGecko returned an invalid historical-price response.",
      "INVALID_RESPONSE",
    );
  }

  const observations = prices.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) return [];
    const timestamp = entry[0];
    const price = entry[1];
    if (
      typeof timestamp !== "number" ||
      !Number.isFinite(timestamp) ||
      typeof price !== "number" ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      return [];
    }
    const observedAt = new Date(timestamp);
    return Number.isNaN(observedAt.getTime())
      ? []
      : [{ observedAt, priceUsd: price }];
  });

  if (prices.length > 0 && observations.length === 0) {
    throw new CoinPriceProviderError(
      "CoinGecko returned no valid historical-price observations.",
      "INVALID_RESPONSE",
    );
  }
  return observations;
}

export async function fetchHistoricalPriceRange(
  coinId: string,
  from: Date,
  to: Date,
  options: HistoricalPriceProviderOptions = {},
): Promise<HistoricalPriceObservation[]> {
  const safeCoinId = encodeURIComponent(assertCoinId(coinId));
  const fromMs = from.getTime();
  const toMs = to.getTime();
  if (
    !Number.isFinite(fromMs) ||
    !Number.isFinite(toMs) ||
    fromMs >= toMs ||
    toMs - fromMs > MAX_RANGE_MS
  ) {
    throw new CoinPriceProviderError(
      "Historical price range must be positive and no longer than three days.",
      "INVALID_RESPONSE",
    );
  }

  const configuration = providerConfiguration(options);
  assertSnapshotPriceConfiguration(options);

  const headers = new Headers({
    accept: "application/json",
    "accept-language": "en-US,en;q=0.9",
  });
  if (configuration.apiKey) {
    headers.set(configuration.headerName, configuration.apiKey);
  }
  const query = new URLSearchParams({
    vs_currency: "usd",
    from: String(Math.floor(fromMs / 1_000)),
    to: String(Math.floor(toMs / 1_000)),
  });
  const url = `${configuration.root}/coins/${safeCoinId}/market_chart/range?${query.toString()}`;
  const request = options.fetch ?? fetch;
  const pause = options.wait ?? wait;

  let lastReason: CoinPriceFailureReason = "UNAVAILABLE";
  let lastStatus: number | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await request(url, {
        headers,
        signal: controller.signal,
        cache: "no-store",
      });
      if (response.ok) {
        return parseObservations(await response.json());
      }

      lastReason = classifyStatus(response.status);
      lastStatus = response.status;
      const retryable =
        lastReason === "RATE_LIMITED" || lastReason === "UNAVAILABLE";
      if (!retryable || attempt === MAX_ATTEMPTS - 1) break;
      await pause(retryDelay(response, attempt));
    } catch (error) {
      if (error instanceof CoinPriceProviderError) {
        throw error;
      }
      lastReason = "UNAVAILABLE";
      lastStatus = null;
      if (attempt === MAX_ATTEMPTS - 1) break;
      await pause(250 * 2 ** attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new CoinPriceProviderError(
    lastReason === "RATE_LIMITED"
      ? "CoinGecko rate limited the historical-price request."
      : lastReason === "UNKNOWN_COIN"
        ? "CoinGecko does not recognize that coin."
        : "CoinGecko historical prices are temporarily unavailable.",
    lastReason,
    lastStatus,
  );
}

function missingReasonForProvider(
  reason: CoinPriceFailureReason,
): Exclude<
  import("./domain.ts").PriceMissingReason,
  "NOT_REQUIRED_ZERO_QUANTITY"
> {
  if (reason === "RATE_LIMITED") return "RATE_LIMITED";
  if (reason === "UNKNOWN_COIN") return "UNKNOWN_COIN";
  if (reason === "INVALID_RESPONSE") return "INVALID_RESPONSE";
  return "PROVIDER_UNAVAILABLE";
}

export function createCoinGeckoSnapshotPriceSource(
  options: HistoricalPriceProviderOptions = {},
): SnapshotPriceSource {
  return {
    async resolve(assetId, requestedAt): Promise<SnapshotPriceResolution> {
      const from = new Date(
        requestedAt.getTime() - MAX_PRICE_OBSERVATION_AGE_MS,
      );
      const to = new Date(requestedAt.getTime() + 60_000);
      try {
        const observations = await fetchHistoricalPriceRange(
          assetId,
          from,
          to,
          options,
        );
        const selected = selectPriceObservation(observations, requestedAt);
        return selected
          ? {
              observation: {
                observedAt: selected.observedAt,
                priceUsd: selected.priceUsd,
              },
            }
          : {
              observation: null,
              missingReason: "NO_ACCEPTABLE_OBSERVATION",
            };
      } catch (error) {
        if (
          error instanceof CoinPriceProviderError &&
          error.reason === "MISSING_CREDENTIAL"
        ) {
          throw error;
        }
        return {
          observation: null,
          missingReason:
            error instanceof CoinPriceProviderError
              ? missingReasonForProvider(error.reason)
              : "PROVIDER_UNAVAILABLE",
        };
      }
    },
  };
}
