import assert from "node:assert/strict";
import test from "node:test";
import {
  adoptionSnapshotTarget,
  capturePortfolioSnapshot,
  dailySnapshotTarget,
  SnapshotCaptureConflict,
} from "../src/services/portfolio-valuation/service.ts";
import { calculateLivePortfolioWorth } from "../src/services/portfolio-valuation/live.ts";
import { runPortfolioSnapshotScheduler } from "../src/services/portfolio-valuation/scheduler.ts";

const adoptionAt = new Date("2026-09-01T03:00:00.000Z");
const dailyTarget = dailySnapshotTarget("2026-09-01");

function state(overrides = {}) {
  return {
    userId: "owner",
    ledgerAdoptedAt: adoptionAt,
    ledgerRevision: 2n,
    activeRevisionNumber: null,
    activeLedgerRevision: null,
    activeLifecycleStatus: null,
    positions: [
      { userAssetId: "btc-position", assetId: "bitcoin", quantity: "2" },
    ],
    previous: {
      kind: "ADOPTION_BASELINE",
      cutoffAt: adoptionAt,
      totalValueUsd: "100",
      positions: [
        {
          userAssetId: "btc-position",
          assetId: "bitcoin",
          quantity: "1",
          priceUsd: "100",
          valueUsd: "100",
        },
      ],
    },
    events: [
      {
        eventId: "buy",
        occurredAt: new Date("2026-09-01T15:00:00.000Z"),
        externalFlowUsd: "120",
        feeUsd: "0",
        movements: [
          {
            userAssetId: "btc-position",
            assetId: "bitcoin",
            role: "PRINCIPAL",
            quantityDelta: "1",
          },
        ],
      },
    ],
    ...overrides,
  };
}

function storeFor(captureState) {
  const published = [];
  return {
    published,
    async readCaptureState() {
      return captureState;
    },
    async publish(draft) {
      published.push(draft);
      return {
        snapshotId: "snapshot",
        revision: 1,
        created: true,
        lifecycleStatus: draft.lifecycleStatus,
      };
    },
  };
}

function priceSource(prices) {
  return {
    async resolve(assetId, requestedAt) {
      const value = prices.get(`${assetId}:${requestedAt.toISOString()}`);
      return value == null
        ? { observation: null, missingReason: "NO_ACCEPTABLE_OBSERVATION" }
        : {
            observation: {
              observedAt: new Date(requestedAt.getTime() - 60_000),
              priceUsd: value,
            },
          };
    },
  };
}

test("snapshot service reconciles price-only and event-driven movement per coin", async () => {
  const store = storeFor(state());
  const prices = new Map([
    [`bitcoin:${dailyTarget.cutoffAt.toISOString()}`, "130"],
    ["bitcoin:2026-09-01T15:00:00.000Z", "120"],
  ]);
  const result = await capturePortfolioSnapshot(store, priceSource(prices), {
    userId: "owner",
    target: dailyTarget,
    provenance: "SCHEDULED",
    actor: "test-scheduler",
    apply: true,
    now: new Date("2026-09-02T03:10:00.000Z"),
  });

  assert.equal(result.draft.totalValueUsd, "260");
  assert.equal(result.draft.netExternalFlowUsd, "120");
  assert.equal(result.draft.feesUsd, "0");
  assert.equal(result.draft.priceMovementUsd, "40");
  assert.equal(result.draft.eventValuationAdjustmentUsd, "0");
  assert.equal(result.draft.marketMovementUsd, "40");
  assert.equal(result.draft.reconciliationStatus, "COMPLETE");
  assert.equal(result.draft.lifecycleStatus, "COMPLETE");
  assert.deepEqual(result.draft.contributions, [
    {
      assetId: "bitcoin",
      externalFlowUsd: "120",
      feesUsd: "0",
      priceMovementUsd: "40",
      eventValuationAdjustmentUsd: "0",
      marketMovementUsd: "40",
    },
  ]);
  assert.equal(store.published.length, 1);
});

test("missing snapshot prices remain null and make valuation incomplete", async () => {
  const store = storeFor(state());
  const result = await capturePortfolioSnapshot(store, priceSource(new Map()), {
    userId: "owner",
    target: dailyTarget,
    provenance: "MANUAL",
    actor: "test-operator",
    apply: false,
    now: new Date("2026-09-02T04:00:00.000Z"),
  });

  assert.equal(result.published, null);
  assert.equal(result.draft.totalValueUsd, null);
  assert.equal(result.draft.knownValueUsd, "0");
  assert.equal(result.draft.positions[0].valueUsd, null);
  assert.equal(result.draft.positions[0].priceQuality, "MISSING");
  assert.equal(
    result.draft.positions[0].missingReason,
    "NO_ACCEPTABLE_OBSERVATION",
  );
  assert.equal(result.draft.lifecycleStatus, "INCOMPLETE");
  assert.equal(result.draft.marketMovementUsd, null);
});

test("capture retries changed ledger or prior valuation inputs with fresh state", async () => {
  let reads = 0;
  let publications = 0;
  const store = {
    async readCaptureState() {
      reads += 1;
      return state({ ledgerRevision: BigInt(reads) });
    },
    async publish(draft) {
      publications += 1;
      if (publications < 3)
        throw new SnapshotCaptureConflict("Concurrent write");
      assert.equal(draft.ledgerRevision, 3n);
      return {
        snapshotId: "retry",
        revision: 1,
        created: true,
        lifecycleStatus: "INCOMPLETE",
      };
    },
  };
  await capturePortfolioSnapshot(store, priceSource(new Map()), {
    userId: "owner",
    target: dailyTarget,
    provenance: "MANUAL",
    actor: "test",
    now: new Date("2026-09-03"),
  });
  assert.equal(reads, 3);
});

test("live prices outside the bounded fallback window are incomplete", () => {
  for (const last_updated of ["2026-09-02T12:00:00Z", "2026-09-02T16:00:00Z"]) {
    const result = calculateLivePortfolioWorth(
      [{ assetId: "bitcoin", amount: "2" }],
      [{ id: "bitcoin", current_price: 100, last_updated }],
      { requestedAt: new Date("2026-09-02T15:00:00Z") },
    );
    assert.equal(result.totalValueUsd, null);
    assert.equal(result.valuationStatus, "INCOMPLETE");
  }
});

test("adoption baseline values only the adoption instant with no contribution history", async () => {
  const target = adoptionSnapshotTarget(adoptionAt);
  const store = storeFor(
    state({
      positions: [
        { userAssetId: "btc-position", assetId: "bitcoin", quantity: "1" },
      ],
      previous: null,
      events: [],
    }),
  );
  const result = await capturePortfolioSnapshot(
    store,
    priceSource(new Map([[`bitcoin:${target.cutoffAt.toISOString()}`, "101"]])),
    {
      userId: "owner",
      target,
      provenance: "ADOPTION_BASELINE",
      actor: "test-operator",
      apply: false,
      now: new Date("2026-09-02T04:00:00.000Z"),
    },
  );

  assert.equal(result.draft.totalValueUsd, "101");
  assert.equal(result.draft.reconciliationStatus, "NOT_APPLICABLE");
  assert.equal(result.draft.positions[0].priceQuality, "HISTORICAL_ESTIMATE");
  assert.deepEqual(result.draft.contributions, []);
  assert.equal(
    result.draft.target.cutoffAt.toISOString(),
    adoptionAt.toISOString(),
  );
});

test("live portfolio worth changes with prices and exposes failed coverage", () => {
  const holdings = [{ assetId: "bitcoin", amount: "2" }];
  const observedAt = "2026-09-02T15:00:00.000Z";
  const now = new Date("2026-09-02T15:01:00.000Z");
  const first = calculateLivePortfolioWorth(
    holdings,
    [
      {
        id: "bitcoin",
        name: "Bitcoin",
        symbol: "btc",
        current_price: 100,
        last_updated: observedAt,
      },
    ],
    { requestedAt: now },
  );
  const second = calculateLivePortfolioWorth(
    holdings,
    [
      {
        id: "bitcoin",
        name: "Bitcoin",
        symbol: "btc",
        current_price: 125,
        last_updated: observedAt,
      },
    ],
    { requestedAt: now },
  );
  const failed = calculateLivePortfolioWorth(holdings, [], {
    requestedAt: now,
    providerFailed: true,
  });

  assert.equal(first.totalValueUsd, "200");
  assert.equal(second.totalValueUsd, "250");
  assert.equal(failed.totalValueUsd, null);
  assert.equal(failed.positions[0].missingReason, "PROVIDER_UNAVAILABLE");
});

test("scheduler repairs stale targets in order and captures only missing daily dates", async () => {
  const calls = [];
  const staleBaseline = adoptionSnapshotTarget(adoptionAt);
  const staleDaily = dailySnapshotTarget("2026-09-01");
  const newDaily = dailySnapshotTarget("2026-09-02");
  const summary = await runPortfolioSnapshotScheduler(
    {
      async listUsers() {
        return [
          {
            userId: "owner",
            ledgerAdoptedAt: adoptionAt,
            hasCompleteAdoptionBaseline: true,
          },
        ];
      },
      async listStaleTargets() {
        return [staleDaily, staleBaseline];
      },
      async listDailyTargets() {
        return [newDaily];
      },
      async capture(input) {
        calls.push(input);
        return {
          draft: { lifecycleStatus: "COMPLETE" },
          published: {
            snapshotId: `snapshot-${calls.length}`,
            revision: 2,
            created: true,
            lifecycleStatus: "COMPLETE",
          },
        };
      },
    },
    new Date("2026-09-03T03:10:00.000Z"),
  );

  assert.deepEqual(
    calls.map((call) => [
      call.target.kind,
      call.target.reportingDate,
      call.provenance,
    ]),
    [
      ["ADOPTION_BASELINE", "2026-09-01", "REPAIR"],
      ["DAILY", "2026-09-01", "REPAIR"],
      ["DAILY", "2026-09-02", "SCHEDULED"],
    ],
  );
  assert.deepEqual(summary, {
    usersProcessed: 1,
    snapshotsCreated: 3,
    snapshotsIncomplete: 0,
    snapshotsSkipped: 0,
  });
});
