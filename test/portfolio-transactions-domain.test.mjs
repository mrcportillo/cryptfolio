import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  assertNonnegativeTimeline,
  buildEventDraft,
  buildReversalDraft,
  correctionKeys,
  eventSignature,
  LedgerValidationError,
} from "../src/services/portfolio-transactions/domain.ts";
import { databaseDecimalToPlain } from "../src/services/portfolio-transactions/decimal.ts";

const adoptedAt = new Date("2026-08-20T12:00:00.000Z");
const now = new Date("2026-08-21T12:00:00.000Z");
const key = "123e4567-e89b-12d3-a456-426614174000";
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function base(kind, overrides = {}) {
  return {
    kind,
    occurredAt: "2026-08-21T10:00:00.000Z",
    idempotencyKey: key,
    note: "  personal note  ",
    ...overrides,
  };
}

test("database decimals project to plain exact text without signed zero", () => {
  assert.equal(
    databaseDecimalToPlain(new Prisma.Decimal("1e-30")),
    "0.000000000000000000000000000001",
  );
  assert.equal(
    databaseDecimalToPlain(new Prisma.Decimal("-1e-18")),
    "-0.000000000000000001",
  );
  assert.equal(databaseDecimalToPlain(new Prisma.Decimal("-0")), "0");
  assert.equal(
    databaseDecimalToPlain(
      new Prisma.Decimal("123456789012345678901234567890.12345"),
    ),
    "123456789012345678901234567890.12345",
  );
});

test("inbound and outbound intents assign signs on the server", () => {
  const buy = buildEventDraft(
    base("BUY", {
      position: { userAssetId: "btc", quantity: "1.2500" },
      actualValueUsd: "100.00",
    }),
    adoptedAt,
    now,
  );
  const sell = buildEventDraft(
    base("SELL", {
      position: { userAssetId: "btc", quantity: "0.25" },
      actualValueUsd: "25",
    }),
    adoptedAt,
    now,
  );

  assert.equal(buy.event.movements[0].quantityDelta, "1.25");
  assert.equal(buy.event.externalFlowUsd, "100");
  assert.equal(buy.event.feeUsd, "0");
  assert.equal(buy.event.note, "personal note");
  assert.equal(sell.event.movements[0].quantityDelta, "-0.25");
  assert.equal(sell.event.externalFlowUsd, "-25");
});

test("unknown money remains null while absent fees are known zero", () => {
  const unknownBuy = buildEventDraft(
    base("BUY", {
      position: { userAssetId: "btc", quantity: "1" },
    }),
    adoptedAt,
    now,
  );
  const unknownCoinFee = buildEventDraft(
    base("BUY", {
      position: { userAssetId: "btc", quantity: "1" },
      fee: { userAssetId: "eth", quantity: "0.01" },
    }),
    adoptedAt,
    now,
  );

  assert.equal(unknownBuy.event.actualValueUsd, null);
  assert.equal(unknownBuy.event.externalFlowUsd, null);
  assert.equal(unknownBuy.event.feeUsd, "0");
  assert.equal(unknownCoinFee.event.feeUsd, null);
  assert.deepEqual(
    unknownCoinFee.event.movements.map(({ role, quantityDelta }) => ({
      role,
      quantityDelta,
    })),
    [
      { role: "PRINCIPAL", quantityDelta: "1" },
      { role: "FEE", quantityDelta: "-0.01" },
    ],
  );
});

test("swaps and standalone fees have crypto-only shapes", () => {
  const swap = buildEventDraft(
    base("SWAP", {
      from: { userAssetId: "btc", quantity: "0.1" },
      to: { userAssetId: "eth", quantity: "2" },
      actualValueUsd: "5000",
      fee: { userAssetId: "eth", quantity: "0.01", valueUsd: "20" },
    }),
    adoptedAt,
    now,
  );
  const fee = buildEventDraft(
    base("FEE", {
      fee: { userAssetId: "eth", quantity: "0.02", valueUsd: "40" },
    }),
    adoptedAt,
    now,
  );

  assert.deepEqual(
    swap.event.movements.map(({ userAssetId, role, quantityDelta }) => ({
      userAssetId,
      role,
      quantityDelta,
    })),
    [
      { userAssetId: "btc", role: "PRINCIPAL", quantityDelta: "-0.1" },
      { userAssetId: "eth", role: "PRINCIPAL", quantityDelta: "2" },
      { userAssetId: "eth", role: "FEE", quantityDelta: "-0.01" },
    ],
  );
  assert.equal(swap.event.externalFlowUsd, "0");
  assert.equal(swap.event.feeUsd, "20");
  assert.deepEqual(
    fee.event.movements.map(({ role, quantityDelta }) => ({
      role,
      quantityDelta,
    })),
    [{ role: "FEE", quantityDelta: "-0.02" }],
  );
  assert.equal(fee.event.actualValueUsd, null);
  assert.equal(fee.event.externalFlowUsd, "0");
  assert.equal(fee.event.feeUsd, "40");
});

test("reversal exactly negates quantities and every known monetary value", () => {
  const originalDraft = buildEventDraft(
    base("SELL", {
      position: { userAssetId: "btc", quantity: "0.5" },
      actualValueUsd: "15000",
      fee: { userAssetId: "eth", quantity: "0.01", valueUsd: "25" },
    }),
    adoptedAt,
    now,
  ).event;
  const original = {
    ...originalDraft,
    id: "event-1",
    userId: "owner",
    idempotencyKey: key,
    createdAt: now,
  };
  const reversal = buildReversalDraft(original);

  assert.equal(
    reversal.occurredAt.toISOString(),
    original.occurredAt.toISOString(),
  );
  assert.equal(reversal.actualValueUsd, "-15000");
  assert.equal(reversal.externalFlowUsd, "15000");
  assert.equal(reversal.feeUsd, "-25");
  assert.deepEqual(
    reversal.movements.map(({ quantityDelta }) => quantityDelta),
    ["0.5", "0.01"],
  );
  assert.equal(reversal.reversalOfEventId, original.id);
});

test("normal inputs reject signed amounts, invalid keys, boundaries, and excess notes", () => {
  const attempts = [
    base("BUY", {
      position: { userAssetId: "btc", quantity: "-1" },
    }),
    base("BUY", {
      position: { userAssetId: "btc", quantity: "1" },
      actualValueUsd: "-2",
    }),
    base("BUY", {
      position: { userAssetId: "btc", quantity: "1" },
      idempotencyKey: "not-a-uuid",
    }),
    base("BUY", {
      position: { userAssetId: "btc", quantity: "1" },
      occurredAt: "2026-08-20T11:59:59.999Z",
    }),
    base("BUY", {
      position: { userAssetId: "btc", quantity: "1" },
      occurredAt: "2026-08-21T12:05:00.001Z",
    }),
    base("BUY", {
      position: { userAssetId: "btc", quantity: "1" },
      note: "x".repeat(501),
    }),
  ];

  for (const intent of attempts) {
    assert.throws(
      () => buildEventDraft(intent, adoptedAt, now),
      LedgerValidationError,
    );
  }
});

test("timestamps require an explicit timezone and normalize independently of process TZ", () => {
  assert.throws(
    () =>
      buildEventDraft(
        base("BUY", {
          occurredAt: "2026-08-21T09:00:00",
          position: { userAssetId: "btc", quantity: "1" },
        }),
        adoptedAt,
        now,
      ),
    (error) =>
      error instanceof LedgerValidationError &&
      /explicit timezone/i.test(error.message),
  );

  const domainUrl = pathToFileURL(
    path.join(projectRoot, "src/services/portfolio-transactions/domain.ts"),
  ).href;
  const script = `
    import { buildEventDraft } from ${JSON.stringify(domainUrl)};
    const result = buildEventDraft({
      kind: "BUY",
      occurredAt: "2026-08-21T09:00:00-03:00",
      idempotencyKey: ${JSON.stringify(key)},
      position: { userAssetId: "btc", quantity: "1" }
    }, new Date("2026-08-20T12:00:00.000Z"), new Date("2026-08-21T12:00:00.000Z"));
    process.stdout.write(result.event.occurredAt.toISOString());
  `;
  const results = ["UTC", "America/Argentina/Salta"].map((timezone) =>
    spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "--eval", script],
      {
        cwd: projectRoot,
        encoding: "utf8",
        env: { ...process.env, TZ: timezone },
      },
    ),
  );
  for (const result of results) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "2026-08-21T12:00:00.000Z");
  }
});

test("explicit-zone timestamps reject impossible calendar dates", () => {
  for (const occurredAt of [
    "2026-00-10T12:00:00Z",
    "2026-13-10T12:00:00Z",
    "2026-02-00T12:00:00Z",
    "2026-02-29T12:00:00Z",
    "2026-02-30T12:00:00Z",
    "2026-04-31T12:00:00-03:00",
  ]) {
    assert.throws(
      () =>
        buildEventDraft(
          base("BUY", {
            occurredAt,
            position: { userAssetId: "btc", quantity: "1" },
          }),
          adoptedAt,
          now,
        ),
      (error) =>
        error instanceof LedgerValidationError &&
        /valid date and time/i.test(error.message),
      occurredAt,
    );
  }
});

test("valid leap days and explicit offsets normalize to the intended UTC instant", () => {
  const leapAdoption = new Date("2028-01-01T00:00:00.000Z");
  const leapNow = new Date("2028-03-01T00:00:00.000Z");
  const offset = buildEventDraft(
    base("BUY", {
      occurredAt: "2028-02-29T09:00:00-03:00",
      position: { userAssetId: "btc", quantity: "1" },
    }),
    leapAdoption,
    leapNow,
  );
  const utc = buildEventDraft(
    base("BUY", {
      occurredAt: "2028-02-29T12:00:00Z",
      position: { userAssetId: "btc", quantity: "1" },
    }),
    leapAdoption,
    leapNow,
  );

  assert.equal(
    offset.event.occurredAt.toISOString(),
    "2028-02-29T12:00:00.000Z",
  );
  assert.equal(utc.event.occurredAt.toISOString(), "2028-02-29T12:00:00.000Z");
});

test("manual intents reject operator-only and audit-only event kinds at runtime", () => {
  for (const kind of ["OPENING_BALANCE", "REVERSAL"]) {
    assert.throws(
      () =>
        buildEventDraft(
          base(kind, {
            position: { userAssetId: "btc", quantity: "1" },
          }),
          adoptedAt,
          now,
        ),
      (error) =>
        error instanceof LedgerValidationError &&
        error.code === "INVALID_INPUT",
    );
  }
});

test("timeline validation rejects current and backdated negative boundaries", () => {
  assert.throws(
    () =>
      assertNonnegativeTimeline([
        {
          eventId: "opening",
          userAssetId: "btc",
          occurredAt: adoptedAt,
          quantityDelta: "1",
        },
        {
          eventId: "sell",
          userAssetId: "btc",
          occurredAt: new Date("2026-08-21T10:00:00.000Z"),
          quantityDelta: "-2",
        },
      ]),
    (error) => error.code === "NEGATIVE_BALANCE",
  );

  assert.throws(
    () =>
      assertNonnegativeTimeline([
        {
          eventId: "opening",
          userAssetId: "btc",
          occurredAt: adoptedAt,
          quantityDelta: "1",
        },
        {
          eventId: "backdated-sell",
          userAssetId: "btc",
          occurredAt: new Date("2026-08-20T13:00:00.000Z"),
          quantityDelta: "-1",
        },
        {
          eventId: "later-sell",
          userAssetId: "btc",
          occurredAt: new Date("2026-08-20T14:00:00.000Z"),
          quantityDelta: "-0.1",
        },
        {
          eventId: "later-buy",
          userAssetId: "btc",
          occurredAt: new Date("2026-08-20T15:00:00.000Z"),
          quantityDelta: "1",
        },
      ]),
    (error) => error.code === "NEGATIVE_BALANCE",
  );
});

test("events at one timestamp are one balance boundary for atomic corrections", () => {
  const balance = assertNonnegativeTimeline([
    {
      eventId: "opening",
      userAssetId: "btc",
      occurredAt: adoptedAt,
      quantityDelta: "1",
    },
    {
      eventId: "original",
      userAssetId: "btc",
      occurredAt: new Date("2026-08-21T10:00:00.000Z"),
      quantityDelta: "-1",
    },
    {
      eventId: "reversal",
      userAssetId: "btc",
      occurredAt: new Date("2026-08-21T10:00:00.000Z"),
      quantityDelta: "1",
    },
    {
      eventId: "replacement",
      userAssetId: "btc",
      occurredAt: new Date("2026-08-21T10:00:00.000Z"),
      quantityDelta: "-0.5",
    },
  ]);
  assert.equal(balance.get("btc"), "0.5");
});

test("correction keys are deterministic and signatures ignore decimal formatting", () => {
  assert.deepEqual(correctionKeys(key), {
    reversal: `reverse:${key}`,
    replacement: `replace:${key}`,
  });
  const first = buildEventDraft(
    base("BUY", {
      position: { userAssetId: "btc", quantity: "1.0" },
      actualValueUsd: "10.00",
    }),
    adoptedAt,
    now,
  ).event;
  assert.equal(eventSignature(first), eventSignature(first));
});
