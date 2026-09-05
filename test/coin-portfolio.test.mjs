import assert from "node:assert/strict";
import test from "node:test";
import {
  addMarketDataToAssets,
  approximateDecimalForMarketDisplay,
  approximateMarketValue,
  calculatePortfolioValue,
} from "../src/services/coin/portfolio.ts";

const markets = [
  {
    id: "bitcoin",
    name: "Bitcoin",
    symbol: "btc",
    current_price: 2,
  },
];

test("market enrichment preserves exact tiny and large quantity strings", () => {
  const tiny = "0.000000000000000000000000000001";
  const large =
    "12345678901234567890123456789012345.123456789012345678901234567890";
  const assets = addMarketDataToAssets(
    [
      {
        id: "tiny",
        assetId: "bitcoin",
        assetName: "Tiny",
        amount: tiny,
        date: new Date("2026-08-20T00:00:00.000Z"),
      },
      {
        id: "large",
        assetId: "bitcoin",
        assetName: "Large",
        amount: large,
        date: new Date("2026-08-20T00:00:00.000Z"),
      },
    ],
    markets,
  );

  assert.equal(assets[0].amount, tiny);
  assert.equal(assets[1].amount, large);
  assert.equal(assets[0].approximateMarketValue, 2e-30);
  assert.equal(
    assets[1].approximateMarketValue,
    Number(large) * markets[0].current_price,
  );
});

test("numeric conversion is explicit and limited to approximate market display math", () => {
  const exact = "12345678901234567890.000000000000000001";

  assert.equal(approximateDecimalForMarketDisplay(exact), Number(exact));
  assert.equal(approximateMarketValue(exact, 2), Number(exact) * 2);
  assert.equal(approximateMarketValue(exact, null), null);
  assert.equal(approximateDecimalForMarketDisplay("not-a-decimal"), null);
});

test("portfolio market value accepts exact strings without mutating their representation", () => {
  const tiny = "0.000000000000000000000000000001";
  const large =
    "12345678901234567890123456789012345.123456789012345678901234567890";
  const holdings = [
    { assetId: "bitcoin", amount: tiny },
    { assetId: "bitcoin", amount: large },
  ];

  assert.equal(
    calculatePortfolioValue(holdings, markets),
    Number(tiny) * 2 + Number(large) * 2,
  );
  assert.deepEqual(
    holdings.map(({ amount }) => amount),
    [tiny, large],
  );
});
