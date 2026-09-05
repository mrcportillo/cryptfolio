import assert from "node:assert/strict";
import test from "node:test";
import { createValuationMarketLoader } from "../src/services/portfolio-valuation/market-cache.ts";

test("live quotes have a bounded, explicit fallback without inventing missing prices", async () => {
  let calls = 0;
  const load = createValuationMarketLoader(async () => {
    if (++calls > 1) throw new Error("rate limited");
    return [
      {
        id: "bitcoin",
        current_price: 100,
        last_updated: "2026-09-05T03:00:00Z",
      },
    ];
  });
  assert.equal(
    (await load(["bitcoin"], new Date("2026-09-05T03:01:00Z"))).usedFallback,
    false,
  );
  const fallback = await load(
    ["bitcoin", "ethereum"],
    new Date("2026-09-05T03:30:00Z"),
  );
  assert.equal(fallback.providerFailed, true);
  assert.equal(fallback.usedFallback, true);
  assert.deepEqual(
    fallback.markets.map((market) => market.id),
    ["bitcoin"],
  );
  assert.deepEqual(
    (await load(["bitcoin"], new Date("2026-09-05T05:01:00Z"))).markets,
    [],
  );
});
