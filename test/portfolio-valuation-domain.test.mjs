import assert from "node:assert/strict";
import test from "node:test";
import {
  addDecimals,
  isWithinDecimalTolerance,
  multiplyDecimals,
  normalizeFiniteNumber,
  sumDecimals,
} from "../src/services/portfolio-transactions/decimal.ts";
import {
  allocatePeriodEvents,
  calculateLiveValuation,
  calculatePeriodReconciliation,
  calculatePriceMovement,
  cutoffAtForReportingDate,
  isClosedReportingDate,
  latestClosedReportingDate,
  PortfolioValuationError,
  priceQualityForObservation,
  reportingDateForInstant,
  selectPriceObservation,
} from "../src/services/portfolio-valuation/domain.ts";

test("scale-30 multiplication rounds ties half away from zero", () => {
  const quantum = "0.000000000000000000000000000001";
  assert.equal(multiplyDecimals(quantum, "0.5"), quantum);
  assert.equal(multiplyDecimals(`-${quantum}`, "0.5"), `-${quantum}`);
  assert.equal(
    multiplyDecimals(quantum, "0.499999999999999999999999999999"),
    "0",
  );
  assert.equal(normalizeFiniteNumber(1e-7), "0.0000001");
  assert.equal(normalizeFiniteNumber(1e21), "1000000000000000000000");
});

test("decimal composition preserves exact intermediates and checks persisted aggregates", () => {
  const maximum = `${"9".repeat(35)}.${"9".repeat(30)}`;
  assert.equal(
    addDecimals(maximum, "0.000000000000000000000000000001"),
    `1${"0".repeat(35)}`,
  );
  assert.throws(() =>
    sumDecimals([maximum, "0.000000000000000000000000000001"]),
  );
  assert.equal(
    isWithinDecimalTolerance(maximum, `-${maximum}`, maximum),
    false,
  );
});

test("Salta dates close at the following local midnight independent of host timezone", () => {
  assert.equal(
    reportingDateForInstant(new Date("2026-09-02T02:59:59.999Z")),
    "2026-09-01",
  );
  assert.equal(
    reportingDateForInstant(new Date("2026-09-02T03:00:00.000Z")),
    "2026-09-02",
  );
  assert.equal(
    cutoffAtForReportingDate("2026-09-01").toISOString(),
    "2026-09-02T03:00:00.000Z",
  );
  assert.equal(
    latestClosedReportingDate(new Date("2026-09-02T03:09:59.999Z")),
    "2026-09-01",
  );
  assert.equal(
    latestClosedReportingDate(new Date("2026-09-02T02:59:59.999Z")),
    "2026-08-31",
  );
  assert.equal(
    isClosedReportingDate("2026-09-01", new Date("2026-09-02T02:59:59.999Z")),
    false,
  );
  assert.equal(
    isClosedReportingDate("2026-09-01", new Date("2026-09-02T03:00:00.000Z")),
    true,
  );
  assert.throws(
    () => cutoffAtForReportingDate("2026-02-30"),
    PortfolioValuationError,
  );
});

test("price selection is deterministic, cutoff-bounded, and maximum-age bounded", () => {
  const requestedAt = new Date("2026-09-02T03:00:00.000Z");
  const selected = selectPriceObservation(
    [
      {
        observedAt: new Date("2026-09-02T02:55:00.000Z"),
        priceUsd: "100.01",
      },
      {
        observedAt: new Date("2026-09-02T03:00:00.001Z"),
        priceUsd: "999",
      },
      {
        observedAt: new Date("2026-09-02T02:55:00.000Z"),
        priceUsd: "100.02",
      },
      {
        observedAt: new Date("2026-09-02T01:00:00.000Z"),
        priceUsd: "98",
      },
    ],
    requestedAt,
  );

  assert.equal(selected?.priceUsd, "100.01");
  assert.equal(selected?.inputIndex, 0);
  assert.equal(selected?.ageMs, 5 * 60 * 1000);
  assert.equal(
    selectPriceObservation(
      [{ observedAt: new Date("2026-09-02T01:00:00.000Z"), priceUsd: 98 }],
      requestedAt,
    )?.priceUsd,
    "98",
  );
  assert.equal(
    selectPriceObservation(
      [
        {
          observedAt: new Date("2026-09-02T00:59:59.999Z"),
          priceUsd: 98,
        },
      ],
      requestedAt,
    ),
    null,
  );
});

test("price quality distinguishes observed, stale fallback, and estimates", () => {
  assert.equal(
    priceQualityForObservation({ ageMs: 15 * 60 * 1000 }, "SCHEDULED"),
    "OBSERVED",
  );
  assert.equal(
    priceQualityForObservation({ ageMs: 15 * 60 * 1000 + 1 }, "SCHEDULED"),
    "STALE_FALLBACK",
  );
  assert.equal(
    priceQualityForObservation({ ageMs: 0 }, "REPAIR"),
    "HISTORICAL_ESTIMATE",
  );
  assert.throws(
    () =>
      selectPriceObservation(
        [{ observedAt: new Date("2026-09-02T03:00:00.000Z"), priceUsd: 0 }],
        new Date("2026-09-02T03:00:00.000Z"),
      ),
    PortfolioValuationError,
  );
});

test("live worth changes from price movement without changing quantities", () => {
  const position = {
    positionId: "position-btc",
    assetId: "bitcoin",
    quantity: "1.25",
    priceObservedAt: new Date("2026-09-02T14:59:00.000Z"),
  };
  const first = calculateLiveValuation(
    [{ ...position, priceUsd: "100" }],
    new Date("2026-09-02T15:00:00.000Z"),
  );
  const second = calculateLiveValuation(
    [{ ...position, priceUsd: "120" }],
    new Date("2026-09-02T15:00:00.000Z"),
  );

  assert.equal(first.totalValueUsd, "125");
  assert.equal(second.totalValueUsd, "150");
  assert.equal(second.positions[0].quantity, first.positions[0].quantity);
});

test("missing live prices remain null and mark only positive holdings incomplete", () => {
  const result = calculateLiveValuation(
    [
      {
        positionId: "btc",
        assetId: "bitcoin",
        quantity: "1",
        priceUsd: null,
        priceObservedAt: null,
        missingReason: "RATE_LIMITED",
      },
      {
        positionId: "eth",
        assetId: "ethereum",
        quantity: "2",
        priceUsd: "50",
        priceObservedAt: new Date("2026-09-02T14:50:00.000Z"),
      },
      {
        positionId: "sol",
        assetId: "solana",
        quantity: "0",
        priceUsd: null,
        priceObservedAt: null,
      },
    ],
    new Date("2026-09-02T15:00:00.000Z"),
  );

  assert.equal(result.valuationStatus, "INCOMPLETE");
  assert.equal(result.totalValueUsd, null);
  assert.equal(result.knownValueUsd, "100");
  assert.equal(result.positions[0].valueUsd, null);
  assert.equal(result.positions[0].priceQuality, "MISSING");
  assert.equal(result.positions[2].valueUsd, "0");
  assert.equal(result.positions[2].missingReason, "NOT_REQUIRED_ZERO_QUANTITY");
});

test("live valuation exposes stale prices and rejects zero masquerading as a price", () => {
  const result = calculateLiveValuation(
    [
      {
        positionId: "btc",
        assetId: "bitcoin",
        quantity: "1",
        priceUsd: "100",
        priceObservedAt: new Date("2026-09-02T14:44:59.999Z"),
      },
    ],
    new Date("2026-09-02T15:00:00.000Z"),
  );
  assert.equal(result.valuationStatus, "STALE");
  assert.equal(result.positions[0].priceQuality, "STALE_FALLBACK");

  assert.throws(
    () =>
      calculateLiveValuation(
        [
          {
            positionId: "btc",
            assetId: "bitcoin",
            quantity: "1",
            priceUsd: "0",
            priceObservedAt: new Date("2026-09-02T15:00:00.000Z"),
          },
        ],
        new Date("2026-09-02T15:00:00.000Z"),
      ),
    PortfolioValuationError,
  );
});

test("backdated boundaries use a deterministic half-open period", () => {
  const startedAt = new Date("2026-09-01T03:00:00.000Z");
  const endedAt = new Date("2026-09-02T03:00:00.000Z");
  const result = calculatePriceMovement({
    startedAt,
    endedAt,
    startingQuantity: "2",
    startingPriceUsd: "100",
    endingPriceUsd: "120",
    boundaries: [
      {
        eventId: "buy-later",
        occurredAt: new Date("2026-09-01T18:00:00.000Z"),
        quantityDelta: "2",
        priceUsd: "115",
      },
      {
        eventId: "sell-backdated",
        occurredAt: new Date("2026-09-01T12:00:00.000Z"),
        quantityDelta: "-1",
        priceUsd: "110",
      },
    ],
  });

  assert.equal(result.endingQuantity, "3");
  assert.equal(result.priceMovementUsd, "40");
  assert.deepEqual(
    result.intervals.map((interval) => interval.movementUsd),
    ["20", "5", "15"],
  );

  const atStart = calculatePriceMovement({
    startedAt,
    endedAt,
    startingQuantity: "1",
    startingPriceUsd: "100",
    endingPriceUsd: "110",
    boundaries: [
      {
        eventId: "at-start",
        occurredAt: startedAt,
        quantityDelta: "1",
        priceUsd: "100",
      },
    ],
  });
  assert.equal(atStart.endingQuantity, "2");
  assert.equal(atStart.priceMovementUsd, "20");

  assert.throws(
    () =>
      calculatePriceMovement({
        startedAt,
        endedAt,
        startingQuantity: "1",
        startingPriceUsd: "100",
        endingPriceUsd: "110",
        boundaries: [
          {
            eventId: "at-end",
            occurredAt: endedAt,
            quantityDelta: "1",
            priceUsd: "110",
          },
        ],
      }),
    /half-open period/,
  );
});

test("event allocation preserves signed reversals and assigns money to one coin", () => {
  const occurredAt = new Date("2026-09-01T12:00:00.000Z");
  const result = allocatePeriodEvents([
    {
      eventId: "buy",
      occurredAt,
      externalFlowUsd: "100",
      feeUsd: "10",
      movements: [
        {
          userAssetId: "btc-position",
          assetId: "bitcoin",
          role: "PRINCIPAL",
          quantityDelta: "1",
        },
        {
          userAssetId: "eth-position",
          assetId: "ethereum",
          role: "FEE",
          quantityDelta: "-0.1",
        },
      ],
    },
    {
      eventId: "reversal",
      occurredAt,
      externalFlowUsd: "-100",
      feeUsd: "-10",
      movements: [
        {
          userAssetId: "btc-position",
          assetId: "bitcoin",
          role: "PRINCIPAL",
          quantityDelta: "-1",
        },
        {
          userAssetId: "eth-position",
          assetId: "ethereum",
          role: "FEE",
          quantityDelta: "0.1",
        },
      ],
    },
  ]);

  assert.equal(result.status, "COMPLETE");
  assert.equal(result.netExternalFlowUsd, "0");
  assert.equal(result.feesUsd, "0");
  assert.deepEqual(result.assets, [
    { assetId: "bitcoin", externalFlowUsd: "0", feesUsd: "0" },
    { assetId: "ethereum", externalFlowUsd: "0", feesUsd: "0" },
  ]);
});

test("unknown event money stays null instead of becoming zero", () => {
  const result = allocatePeriodEvents([
    {
      eventId: "unknown-transfer",
      occurredAt: new Date("2026-09-01T12:00:00.000Z"),
      externalFlowUsd: null,
      feeUsd: null,
      movements: [
        {
          userAssetId: "btc-position",
          assetId: "bitcoin",
          role: "PRINCIPAL",
          quantityDelta: "1",
        },
      ],
    },
  ]);

  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.netExternalFlowUsd, null);
  assert.equal(result.feesUsd, null);
  assert.equal(result.issues.length, 2);
});

test("swaps, sells, and standalone fees allocate without inventing swap flow", () => {
  const occurredAt = new Date("2026-09-01T12:00:00.000Z");
  const result = allocatePeriodEvents([
    {
      eventId: "swap",
      occurredAt,
      externalFlowUsd: "0",
      feeUsd: "5",
      movements: [
        {
          userAssetId: "btc-position",
          assetId: "bitcoin",
          role: "PRINCIPAL",
          quantityDelta: "-1",
        },
        {
          userAssetId: "eth-position",
          assetId: "ethereum",
          role: "PRINCIPAL",
          quantityDelta: "10",
        },
        {
          userAssetId: "eth-position",
          assetId: "ethereum",
          role: "FEE",
          quantityDelta: "-0.1",
        },
      ],
    },
    {
      eventId: "sell",
      occurredAt,
      externalFlowUsd: "-50",
      feeUsd: "0",
      movements: [
        {
          userAssetId: "btc-position",
          assetId: "bitcoin",
          role: "PRINCIPAL",
          quantityDelta: "-0.5",
        },
      ],
    },
    {
      eventId: "fee",
      occurredAt,
      externalFlowUsd: "0",
      feeUsd: "2",
      movements: [
        {
          userAssetId: "sol-position",
          assetId: "solana",
          role: "FEE",
          quantityDelta: "-0.01",
        },
      ],
    },
  ]);

  assert.equal(result.status, "COMPLETE");
  assert.equal(result.netExternalFlowUsd, "-50");
  assert.equal(result.feesUsd, "7");
  assert.deepEqual(result.assets, [
    { assetId: "bitcoin", externalFlowUsd: "-50", feesUsd: "0" },
    { assetId: "ethereum", externalFlowUsd: "0", feesUsd: "5" },
    { assetId: "solana", externalFlowUsd: "0", feesUsd: "2" },
  ]);
});

test("portfolio and per-coin movement reconcile with event valuation adjustment", () => {
  const result = calculatePeriodReconciliation({
    startingValueUsd: "150",
    endingValueUsd: "305",
    netExternalFlowUsd: "150",
    feesUsd: "5",
    coins: [
      {
        assetId: "bitcoin",
        startingValueUsd: "60",
        endingValueUsd: "160",
        externalFlowUsd: "90",
        feesUsd: "0",
        priceMovementUsd: "25",
      },
      {
        assetId: "bitcoin",
        startingValueUsd: "40",
        endingValueUsd: "100",
        externalFlowUsd: "60",
        feesUsd: "0",
        priceMovementUsd: "15",
      },
      {
        assetId: "ethereum",
        startingValueUsd: "50",
        endingValueUsd: "45",
        externalFlowUsd: "0",
        feesUsd: "5",
        priceMovementUsd: "0",
      },
    ],
  });

  assert.equal(result.status, "COMPLETE");
  assert.equal(result.reconciliationStatus, "RECONCILED");
  assert.equal(result.marketMovementUsd, "10");
  assert.equal(result.priceMovementUsd, "40");
  assert.equal(result.eventValuationAdjustmentUsd, "-30");
  assert.equal(result.reconciliationDifferenceUsd, "0");
  assert.deepEqual(
    result.contributions.map(
      ({ assetId, marketMovementUsd, eventValuationAdjustmentUsd }) => ({
        assetId,
        marketMovementUsd,
        eventValuationAdjustmentUsd,
      }),
    ),
    [
      {
        assetId: "bitcoin",
        marketMovementUsd: "10",
        eventValuationAdjustmentUsd: "-30",
      },
      {
        assetId: "ethereum",
        marketMovementUsd: "0",
        eventValuationAdjustmentUsd: "0",
      },
    ],
  );
  assert.equal(
    addDecimals(result.priceMovementUsd, result.eventValuationAdjustmentUsd),
    result.marketMovementUsd,
  );
});

test("contribution mismatches use exact tolerance and missing values stay incomplete", () => {
  const tolerated = calculatePeriodReconciliation({
    startingValueUsd: "100.00000001",
    endingValueUsd: "110",
    netExternalFlowUsd: "0",
    feesUsd: "0",
    coins: [
      {
        assetId: "bitcoin",
        startingValueUsd: "100",
        endingValueUsd: "110",
        externalFlowUsd: "0",
        feesUsd: "0",
        priceMovementUsd: "10",
      },
    ],
  });
  assert.equal(tolerated.reconciliationStatus, "RECONCILED");

  const outsideTolerance = calculatePeriodReconciliation({
    startingValueUsd: "100.00000002",
    endingValueUsd: "110",
    netExternalFlowUsd: "0",
    feesUsd: "0",
    coins: [
      {
        assetId: "bitcoin",
        startingValueUsd: "100",
        endingValueUsd: "110",
        externalFlowUsd: "0",
        feesUsd: "0",
        priceMovementUsd: "10",
      },
    ],
  });
  assert.equal(outsideTolerance.reconciliationStatus, "OUT_OF_TOLERANCE");

  const missing = calculatePeriodReconciliation({
    startingValueUsd: "100",
    endingValueUsd: null,
    netExternalFlowUsd: "0",
    feesUsd: "0",
    coins: [
      {
        assetId: "bitcoin",
        startingValueUsd: "100",
        endingValueUsd: null,
        externalFlowUsd: "0",
        feesUsd: "0",
        priceMovementUsd: null,
      },
    ],
  });
  assert.equal(missing.status, "INCOMPLETE");
  assert.equal(missing.endingValueUsd, null);
  assert.equal(missing.marketMovementUsd, null);
  assert.equal(missing.contributions[0].marketMovementUsd, null);
  assert.equal(missing.contributions[0].eventValuationAdjustmentUsd, null);
});

test("reconciliation rejects impossible negative worth", () => {
  assert.throws(
    () =>
      calculatePeriodReconciliation({
        startingValueUsd: "-1",
        endingValueUsd: "0",
        netExternalFlowUsd: "0",
        feesUsd: "0",
        coins: [],
      }),
    PortfolioValuationError,
  );
});
