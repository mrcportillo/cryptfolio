import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ASSET_NAME_LENGTH,
  validateAssetFormData,
} from "../src/lib/validation.ts";

function formData(values) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) {
    result.set(key, value);
  }
  return result;
}

test("accepts a valid asset form", () => {
  const result = validateAssetFormData(
    formData({ coin: "bitcoin", name: "Long-term BTC", amount: "0.25" }),
  );

  assert.deepEqual(result.values, {
    assetId: "bitcoin",
    assetName: "Long-term BTC",
    amount: 0.25,
  });
});

test("rejects invalid amounts and coin ids", () => {
  const result = validateAssetFormData(
    formData({ coin: "bitcoin?x=1", name: "BTC", amount: "Infinity" }),
  );

  assert.equal(result.values, undefined);
  assert.equal(result.fieldErrors?.coin, "Select a valid coin.");
  assert.equal(
    result.fieldErrors?.amount,
    "Enter a finite amount greater than zero.",
  );
});

test("rejects aliases longer than the configured limit", () => {
  const result = validateAssetFormData(
    formData({
      coin: "bitcoin",
      name: "a".repeat(MAX_ASSET_NAME_LENGTH + 1),
      amount: "1",
    }),
  );

  assert.equal(result.values, undefined);
  assert.match(result.fieldErrors?.name ?? "", /characters or fewer/);
});

test("requires a valid caller-observed version for update forms", () => {
  const missing = validateAssetFormData(
    formData({ id: "position", name: "BTC", amount: "1" }),
    { requireId: true, requireCoin: false, requireVersion: true },
  );
  assert.equal(
    missing.fieldErrors?.id,
    "Reload the asset before saving your changes.",
  );

  const version = "2026-08-20T12:00:00.000Z";
  const valid = validateAssetFormData(
    formData({ id: "position", version, name: "BTC", amount: "1" }),
    { requireId: true, requireCoin: false, requireVersion: true },
  );
  assert.equal(valid.values?.expectedDate?.toISOString(), version);
});
