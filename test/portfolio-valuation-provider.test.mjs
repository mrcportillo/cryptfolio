import assert from "node:assert/strict";
import test from "node:test";

import {
  CoinPriceProviderError,
  createCoinGeckoSnapshotPriceSource,
  fetchHistoricalPriceRange,
} from "../src/services/portfolio-valuation/provider.ts";

const from = new Date("2026-08-28T03:00:00.000Z");
const to = new Date("2026-08-29T03:00:00.000Z");

test("historical provider uses encoded fixed range, header auth, and no cache", async () => {
  let captured;
  const observations = await fetchHistoricalPriceRange("bitcoin", from, to, {
    apiKey: "demo-key",
    fetch: async (url, init) => {
      captured = { url: String(url), init };
      return Response.json({ prices: [[from.getTime(), 123.456]] });
    },
  });

  assert.equal(observations[0].priceUsd, 123.456);
  assert.equal(observations[0].observedAt.toISOString(), from.toISOString());
  assert.match(captured.url, /\/coins\/bitcoin\/market_chart\/range\?/);
  assert.match(captured.url, /vs_currency=usd/);
  assert.equal(captured.init.headers.get("x-cg-demo-api-key"), "demo-key");
  assert.equal(captured.init.cache, "no-store");
});

test("snapshot price source deterministically selects a prior observation", async () => {
  const requestedAt = new Date("2026-08-29T03:00:00.000Z");
  const source = createCoinGeckoSnapshotPriceSource({
    apiKey: "demo-key",
    fetch: async () =>
      Response.json({
        prices: [
          [requestedAt.getTime() - 60_000, 120.25],
          [requestedAt.getTime() + 30_000, 999],
        ],
      }),
  });
  const selected = await source.resolve("bitcoin", requestedAt);
  assert.deepEqual(selected, {
    observation: {
      observedAt: new Date("2026-08-29T02:59:00.000Z"),
      priceUsd: "120.25",
    },
  });

  const unavailable = createCoinGeckoSnapshotPriceSource({
    apiKey: "demo-key",
    fetch: async () => new Response("missing", { status: 404 }),
  });
  assert.deepEqual(await unavailable.resolve("bitcoin", requestedAt), {
    observation: null,
    missingReason: "UNKNOWN_COIN",
  });
});

test("historical provider fails closed without a server credential", async () => {
  await assert.rejects(
    fetchHistoricalPriceRange("bitcoin", from, to, {
      apiKey: "",
      fetch: async () => {
        throw new Error("must not fetch");
      },
    }),
    (error) =>
      error instanceof CoinPriceProviderError &&
      error.reason === "MISSING_CREDENTIAL",
  );
});

test("historical provider preserves rate-limit status after bounded retries", async () => {
  let attempts = 0;
  const waits = [];
  await assert.rejects(
    fetchHistoricalPriceRange("bitcoin", from, to, {
      apiKey: "demo-key",
      fetch: async () => {
        attempts += 1;
        return new Response("limited", {
          status: 429,
          headers: { "retry-after": "0" },
        });
      },
      wait: async (milliseconds) => waits.push(milliseconds),
    }),
    (error) =>
      error instanceof CoinPriceProviderError &&
      error.reason === "RATE_LIMITED" &&
      error.status === 429,
  );
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [0, 0]);
});

test("historical provider distinguishes unknown coin and invalid responses", async () => {
  await assert.rejects(
    fetchHistoricalPriceRange("bitcoin", from, to, {
      apiKey: "demo-key",
      fetch: async () => new Response("missing", { status: 404 }),
    }),
    (error) =>
      error instanceof CoinPriceProviderError &&
      error.reason === "UNKNOWN_COIN",
  );

  await assert.rejects(
    fetchHistoricalPriceRange("bitcoin", from, to, {
      apiKey: "demo-key",
      fetch: async () => Response.json({ prices: [["bad", null]] }),
    }),
    (error) =>
      error instanceof CoinPriceProviderError &&
      error.reason === "INVALID_RESPONSE",
  );
});
