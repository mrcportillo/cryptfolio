import assert from "node:assert/strict";
import test from "node:test";
import {
  absoluteDecimal,
  formatExactDecimal,
  formatExactUsd,
  formatPortfolioInputDate,
  formatSignedQuantity,
  movementPriceProvenance,
  toExplicitPortfolioTimestamp,
  transactionKindLabel,
} from "../src/lib/portfolio-transaction-ui.ts";
import { transactionFormValuesFromEvent } from "../src/lib/portfolio-transaction-form.ts";

function storedEvent(overrides = {}) {
  return {
    id: "event-1",
    userId: "owner",
    kind: "SWAP",
    occurredAt: new Date("2026-08-20T14:57:00.000Z"),
    actualValueUsd: "5000.000",
    externalFlowUsd: "0",
    feeUsd: "20.00",
    note: "Cold wallet rebalance",
    reversalOfEventId: null,
    replacementForEventId: null,
    idempotencyKey: "123e4567-e89b-12d3-a456-426614174000",
    createdAt: new Date("2026-08-20T15:00:00.000Z"),
    movements: [
      {
        userAssetId: "btc",
        role: "PRINCIPAL",
        quantityDelta: "-0.1000",
        unitPriceUsd: null,
        priceEstimated: false,
      },
      {
        userAssetId: "eth",
        role: "PRINCIPAL",
        quantityDelta: "2.5000",
        unitPriceUsd: null,
        priceEstimated: false,
      },
      {
        userAssetId: "eth",
        role: "FEE",
        quantityDelta: "-0.0100",
        unitPriceUsd: null,
        priceEstimated: false,
      },
    ],
    ...overrides,
  };
}

test("financial presentation keeps exact decimal strings", () => {
  assert.equal(
    formatExactDecimal("12345678901234567890.000001"),
    "12,345,678,901,234,567,890.000001",
  );
  assert.equal(formatExactUsd(null), "Unknown · unvalued");
  assert.equal(formatExactUsd("0"), "$0");
  assert.equal(formatExactUsd("-1234.5000"), "−$1,234.5000");
  assert.equal(
    formatSignedQuantity("0.000000000000000001"),
    "+0.000000000000000001",
  );
  assert.equal(formatSignedQuantity("-12.50"), "−12.50");
  assert.equal(absoluteDecimal("-0.2500"), "0.2500");
});

test("local transaction time is submitted with the configured Salta offset", () => {
  assert.equal(
    toExplicitPortfolioTimestamp("2026-08-20T11:57"),
    "2026-08-20T11:57:00-03:00",
  );
  assert.equal(
    new Date(toExplicitPortfolioTimestamp("2026-08-20T11:57")).toISOString(),
    "2026-08-20T14:57:00.000Z",
  );
  assert.equal(
    formatPortfolioInputDate(new Date("2026-08-20T14:57:00.000Z")),
    "2026-08-20T11:57:00.000",
  );
  assert.throws(() => toExplicitPortfolioTimestamp("2026-08-20"));
});

test("local timestamp validation rejects impossible calendar and clock values", () => {
  for (const impossible of [
    "2026-00-20T11:57",
    "2026-13-20T11:57",
    "2026-02-29T11:57",
    "2024-02-30T11:57",
    "2026-04-31T11:57",
    "2026-08-20T24:00",
    "2026-08-20T23:60",
    "2026-08-20T23:59:60",
  ]) {
    assert.throws(
      () => toExplicitPortfolioTimestamp(impossible),
      /valid local date and time/,
    );
  }

  assert.equal(
    toExplicitPortfolioTimestamp("2024-02-29T23:59:59.999"),
    "2024-02-29T23:59:59.999-03:00",
  );
});

test("ledger language distinguishes kinds and price provenance", () => {
  assert.equal(transactionKindLabel("OPENING_BALANCE"), "Opening balance");
  assert.equal(transactionKindLabel("TRANSFER_OUT"), "Transfer out");
  assert.equal(
    movementPriceProvenance({ unitPriceUsd: null, priceEstimated: false }),
    "No unit price recorded",
  );
  assert.equal(
    movementPriceProvenance({ unitPriceUsd: "100", priceEstimated: true }),
    "Estimated unit price",
  );
});

test("correction defaults reconstruct a complete exact-string swap intent", () => {
  const exactOccurredAt = new Date("2026-08-20T14:57:59.999Z");
  const values = transactionFormValuesFromEvent(
    storedEvent({ occurredAt: exactOccurredAt }),
  );
  assert.equal(values.kind, "SWAP");
  assert.equal(values.occurredLocal, "2026-08-20T11:57:59.999");
  assert.equal(
    new Date(toExplicitPortfolioTimestamp(values.occurredLocal)).toISOString(),
    exactOccurredAt.toISOString(),
  );
  assert.equal(values.swapFromId, "btc");
  assert.equal(values.swapFromQuantity, "0.1000");
  assert.equal(values.swapToId, "eth");
  assert.equal(values.swapToQuantity, "2.5000");
  assert.equal(values.actualValueUsd, "5000.000");
  assert.equal(values.feeEnabled, true);
  assert.equal(values.feeQuantity, "0.0100");
  assert.equal(values.feeValueUsd, "20.00");
});

test("opening and reversal events cannot seed correction forms", () => {
  assert.throws(() =>
    transactionFormValuesFromEvent(
      storedEvent({ kind: "OPENING_BALANCE", movements: [] }),
    ),
  );
});
