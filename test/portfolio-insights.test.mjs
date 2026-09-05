import assert from "node:assert/strict";
import test from "node:test";
import {
  allocationDrift,
  boundedDecimal,
  personalTremors,
  runStressScenario,
  validateAllocation,
  validateScenario,
} from "../src/services/portfolio-insights/domain.ts";
import { divideDecimals } from "../src/services/portfolio-transactions/decimal.ts";

function valuation(status = "COMPLETE") {
  return {
    valuationStatus: status,
    totalValueUsd: "300",
    knownValueUsd: "300",
    positions: [
      {
        positionId: "cold",
        assetId: "bitcoin",
        quantity: "1",
        valueUsd: "200",
        priceQuality: "OBSERVED",
      },
      {
        positionId: "hot",
        assetId: "ethereum",
        quantity: "2",
        valueUsd: "100",
        priceQuality: "OBSERVED",
      },
    ],
  };
}

test("ranges and shocks reject nonfinite, excess precision, duplicates and invalid bounds", () => {
  assert.deepEqual(validateAllocation("10.00", "80"), {
    minimumPct: "10",
    maximumPct: "80",
  });
  for (const pair of [
    ["80", "10"],
    ["-1", "10"],
    ["10", "101"],
    ["NaN", "100"],
    ["0.001", "10"],
  ])
    assert.throws(() => validateAllocation(...pair));
  assert.throws(() => boundedDecimal("Infinity", "Impact", "0", "100"));
  assert.throws(() => validateScenario("", []));
  for (const percent of ["-100.01", "1000.01", "NaN", "1e2"])
    assert.throws(() =>
      validateScenario("Crash", [{ assetId: "bitcoin", percent }]),
    );
  assert.throws(() =>
    validateScenario("Duplicate", [
      { assetId: "bitcoin", percent: "-20" },
      { assetId: "bitcoin", percent: "10" },
    ]),
  );
  assert.throws(() =>
    validateScenario("Bad coin", [{ assetId: "../../etc", percent: "20" }]),
  );
});

test("exact division rounds negative and positive repeating decimals symmetrically", () => {
  assert.equal(divideDecimals("1", "3"), "0.333333333333333333333333333333");
  assert.equal(divideDecimals("-2", "3"), "-0.666666666666666666666666666667");
  assert.throws(() => divideDecimals("1", "0"));
});

test("personal tremors rank held USD impact and suppress immaterial percentage moves", () => {
  const markets = [
    { id: "bitcoin", price_change_percentage_24h: 100 },
    { id: "ethereum", price_change_percentage_24h: -50 },
    { id: "unheld", price_change_percentage_24h: 1000 },
  ];
  const result = personalTremors(valuation(), markets, "50");
  assert.deepEqual(
    result.map((coin) => [coin.assetId, coin.impactUsd]),
    [
      ["bitcoin", "100"],
      ["ethereum", "-100"],
    ],
  );
  assert.deepEqual(personalTremors(valuation(), markets, "101"), []);
  const emptyPosition = valuation();
  emptyPosition.positions.push({
    positionId: "sold",
    assetId: "unheld",
    quantity: "0",
    valueUsd: "0",
  });
  assert.equal(personalTremors(emptyPosition, markets, "0").length, 2);
  assert.equal(
    runStressScenario(emptyPosition, [
      { assetId: "unheld", percent: "500" },
    ]).coins.find((coin) => coin.assetId === "unheld").held,
    false,
  );
  assert.deepEqual(
    personalTremors(
      valuation(),
      [{ id: "bitcoin", price_change_percentage_24h: 1e-100 }],
      "0",
    ),
    [],
  );
});

test("allocation uses exact position values and never suggests drift from incomplete prices", () => {
  const targets = [
    { userAssetId: "cold", minimumPct: "20", maximumPct: "50" },
    { userAssetId: "hot", minimumPct: "40", maximumPct: "60" },
  ];
  const result = allocationDrift(valuation(), targets);
  assert.deepEqual(
    result.map((row) => [row.status, row.adjustmentUsd]),
    [
      ["ABOVE", "-50"],
      ["BELOW", "20"],
    ],
  );
  assert.ok(
    allocationDrift(valuation("STALE"), targets).every(
      (row) => row.status === "INCOMPLETE" && row.adjustmentUsd === null,
    ),
  );
});

test("stress scenarios include unshocked coins, preserve inputs and propagate missing or stale prices", () => {
  const input = valuation();
  const before = structuredClone(input);
  const result = runStressScenario(input, [
    { assetId: "bitcoin", percent: "-100" },
    { assetId: "unheld", percent: "500" },
  ]);
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.projectedValueUsd, "100");
  assert.equal(result.impactUsd, "-200");
  assert.equal(
    result.coins.find((coin) => coin.assetId === "unheld").held,
    false,
  );
  assert.deepEqual(input, before);
  assert.equal(
    runStressScenario(valuation("STALE"), []).projectedValueUsd,
    null,
  );
  const missing = valuation("INCOMPLETE");
  missing.totalValueUsd = null;
  missing.positions[0].valueUsd = null;
  const partial = runStressScenario(missing, [
    { assetId: "bitcoin", percent: "-20" },
  ]);
  assert.equal(partial.projectedValueUsd, null);
  assert.equal(
    partial.coins.find((coin) => coin.assetId === "bitcoin").impactUsd,
    null,
  );
  assert.equal(partial.knownProjectedValueUsd, "100");
});
