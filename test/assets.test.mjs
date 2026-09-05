import assert from "node:assert/strict";
import test from "node:test";
import { sortAssetsByValue } from "../src/lib/assets.ts";

test("assets are sorted by descending total value without mutating the input", () => {
  const assets = [
    { id: "low", approximateMarketValue: 20 },
    { id: "missing-price", approximateMarketValue: null },
    { id: "high", approximateMarketValue: 60 },
  ];

  const sortedAssets = sortAssetsByValue(assets);

  assert.deepEqual(
    sortedAssets.map((asset) => asset.id),
    ["high", "low", "missing-price"],
  );
  assert.deepEqual(
    assets.map((asset) => asset.id),
    ["low", "missing-price", "high"],
  );
});
