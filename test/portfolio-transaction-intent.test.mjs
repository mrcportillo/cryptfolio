import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTransactionIntent,
  defaultTransactionFormValues,
  feeEnabledAfterKindChange,
  validateTransactionFormValues,
} from "../src/lib/portfolio-transaction-intent.ts";
import { TRANSACTION_KIND_OPTIONS } from "../src/lib/portfolio-transaction-ui.ts";

const idempotencyKey = "123e4567-e89b-12d3-a456-426614174000";

function valuesFor(kind) {
  return {
    ...defaultTransactionFormValues(
      kind,
      false,
      "position-a",
      "2026-08-20T11:57:59.999",
    ),
    note: "  exact draft  ",
    actualValueUsd: "12345678901234567890.000001",
    positionId: "position-a",
    quantity: "0.000000000000000001",
    swapFromId: "position-a",
    swapFromQuantity: "0.1000",
    swapToId: "position-b",
    swapToQuantity: "2.5000",
  };
}

test("the form exposes exactly the six user-recordable transaction kinds", () => {
  assert.deepEqual(
    TRANSACTION_KIND_OPTIONS.map(({ value }) => value),
    ["BUY", "SELL", "TRANSFER_IN", "TRANSFER_OUT", "SWAP", "FEE"],
  );
});

test("all six form kinds map positive exact-string magnitudes without numeric parsing", () => {
  const buy = valuesFor("BUY");
  buy.positionMode = "new";
  buy.newAssetId = "bitcoin";
  buy.newAssetName = "  Cold BTC  ";

  const transferIn = valuesFor("TRANSFER_IN");
  const sell = valuesFor("SELL");
  const transferOut = valuesFor("TRANSFER_OUT");

  const swap = valuesFor("SWAP");
  swap.swapToMode = "new";
  swap.newAssetId = "ethereum";
  swap.newAssetName = "  Staked ETH  ";

  const fee = valuesFor("FEE");
  fee.feePositionId = "position-fee";
  fee.feeQuantity = "0.000000000000000009";
  fee.feeValueUsd = "0.000000000000000123";

  for (const values of [buy, transferIn, sell, transferOut, swap, fee]) {
    assert.deepEqual(validateTransactionFormValues(values), {});
  }

  assert.deepEqual(buildTransactionIntent(buy, idempotencyKey), {
    kind: "BUY",
    occurredAt: "2026-08-20T11:57:59.999-03:00",
    idempotencyKey,
    note: "exact draft",
    actualValueUsd: "12345678901234567890.000001",
    position: {
      newPosition: { assetId: "bitcoin", assetName: "Cold BTC" },
      quantity: "0.000000000000000001",
    },
    fee: null,
  });
  assert.deepEqual(buildTransactionIntent(transferIn, idempotencyKey), {
    kind: "TRANSFER_IN",
    occurredAt: "2026-08-20T11:57:59.999-03:00",
    idempotencyKey,
    note: "exact draft",
    actualValueUsd: "12345678901234567890.000001",
    position: {
      userAssetId: "position-a",
      quantity: "0.000000000000000001",
    },
    fee: null,
  });
  assert.deepEqual(buildTransactionIntent(sell, idempotencyKey), {
    kind: "SELL",
    occurredAt: "2026-08-20T11:57:59.999-03:00",
    idempotencyKey,
    note: "exact draft",
    actualValueUsd: "12345678901234567890.000001",
    position: {
      userAssetId: "position-a",
      quantity: "0.000000000000000001",
    },
    fee: null,
  });
  assert.equal(
    buildTransactionIntent(transferOut, idempotencyKey).kind,
    "TRANSFER_OUT",
  );
  assert.deepEqual(buildTransactionIntent(swap, idempotencyKey), {
    kind: "SWAP",
    occurredAt: "2026-08-20T11:57:59.999-03:00",
    idempotencyKey,
    note: "exact draft",
    actualValueUsd: "12345678901234567890.000001",
    from: { userAssetId: "position-a", quantity: "0.1000" },
    to: {
      newPosition: { assetId: "ethereum", assetName: "Staked ETH" },
      quantity: "2.5000",
    },
    fee: null,
  });
  assert.deepEqual(buildTransactionIntent(fee, idempotencyKey), {
    kind: "FEE",
    occurredAt: "2026-08-20T11:57:59.999-03:00",
    idempotencyKey,
    note: "exact draft",
    fee: {
      userAssetId: "position-fee",
      quantity: "0.000000000000000009",
      valueUsd: "0.000000000000000123",
    },
  });
});

test("leaving standalone fee restores the user's optional-fee choice", () => {
  assert.equal(feeEnabledAfterKindChange("BUY", "FEE", false, false), true);
  assert.equal(feeEnabledAfterKindChange("FEE", "SELL", true, false), false);
  assert.equal(feeEnabledAfterKindChange("FEE", "SWAP", true, true), true);
  assert.equal(feeEnabledAfterKindChange("BUY", "SELL", true, false), true);
});
