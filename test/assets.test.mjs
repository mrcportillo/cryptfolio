import assert from "node:assert/strict";
import test from "node:test";
import { sortAssetsByValue } from "../src/lib/assets.ts";

test("assets are sorted by descending total value without mutating the input", () => {
  const assets = [
    { id: "low", amount: 2, price: 10 },
    { id: "missing-price", amount: 100, price: null },
    { id: "high", amount: 3, price: 20 },
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
