import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  findOwnedPortfolioEvent,
  listOwnedPortfolioEvents,
  listOwnedTransactionPositions,
} from "../src/services/portfolio-transactions/queries.ts";

function eventFixture(overrides = {}) {
  return {
    id: "event-1",
    userId: "owner",
    kind: "BUY",
    occurredAt: new Date("2026-08-20T15:00:00.000Z"),
    actualValueUsd: new Prisma.Decimal("100"),
    externalFlowUsd: new Prisma.Decimal("100"),
    feeUsd: new Prisma.Decimal("0"),
    note: null,
    idempotencyKey: "123e4567-e89b-12d3-a456-426614174000",
    reversalOfEventId: null,
    replacementForEventId: null,
    createdAt: new Date("2026-08-20T15:00:01.000Z"),
    movements: [
      {
        userAssetId: "btc",
        role: "PRINCIPAL",
        quantityDelta: new Prisma.Decimal("1.2500"),
        unitPriceUsd: null,
        priceEstimated: false,
      },
    ],
    reversedBy: { id: "reversal-1" },
    replacedBy: { id: "replacement-1" },
    ...overrides,
  };
}

test("event detail is owner-scoped and projects forward reversal links", async () => {
  let query;
  const event = await findOwnedPortfolioEvent(
    {
      portfolioEvent: {
        async findFirst(args) {
          query = args;
          return eventFixture();
        },
      },
    },
    "owner",
    "event-1",
  );

  assert.deepEqual(query.where, { id: "event-1", userId: "owner" });
  assert.deepEqual(query.include.reversedBy, { select: { id: true } });
  assert.deepEqual(query.include.replacedBy, { select: { id: true } });
  assert.equal(event.reversedByEventId, "reversal-1");
  assert.equal(event.replacedByEventId, "replacement-1");
  assert.equal(event.movements[0].quantityDelta, "1.25");
});

test("event detail does not fall back to an id-only cross-owner lookup", async () => {
  const event = await findOwnedPortfolioEvent(
    {
      portfolioEvent: {
        async findFirst(args) {
          assert.deepEqual(args.where, {
            id: "other-owner-event",
            userId: "owner",
          });
          return null;
        },
      },
    },
    "owner",
    "other-owner-event",
  );

  assert.equal(event, null);
});

test("event detail and history project minimum-scale decimals without exponents", async () => {
  const tinyEvent = eventFixture({
    actualValueUsd: new Prisma.Decimal("1e-30"),
    externalFlowUsd: new Prisma.Decimal("1e-30"),
    feeUsd: new Prisma.Decimal("1e-18"),
    movements: [
      {
        userAssetId: "btc",
        role: "PRINCIPAL",
        quantityDelta: new Prisma.Decimal("1e-30"),
        unitPriceUsd: new Prisma.Decimal("1e-18"),
        priceEstimated: false,
      },
    ],
  });
  const client = {
    portfolioEvent: {
      async findFirst() {
        return tinyEvent;
      },
      async findMany() {
        return [tinyEvent];
      },
    },
  };

  const detail = await findOwnedPortfolioEvent(client, "owner", "event-1");
  const history = await listOwnedPortfolioEvents(client, "owner", {
    page: 1,
    pageSize: 10,
  });
  for (const event of [detail, history.events[0]]) {
    assert.equal(event.actualValueUsd, "0.000000000000000000000000000001");
    assert.equal(event.externalFlowUsd, "0.000000000000000000000000000001");
    assert.equal(event.feeUsd, "0.000000000000000001");
    assert.equal(
      event.movements[0].quantityDelta,
      "0.000000000000000000000000000001",
    );
    assert.equal(event.movements[0].unitPriceUsd, "0.000000000000000001");
  }
});

test("event history keeps owner scoping while exposing null forward links", async () => {
  let query;
  const result = await listOwnedPortfolioEvents(
    {
      portfolioEvent: {
        async findMany(args) {
          query = args;
          return [
            eventFixture({ reversedBy: null, replacedBy: null }),
            eventFixture({ id: "overflow" }),
          ];
        },
      },
    },
    "owner",
    { page: 2, pageSize: 1 },
  );

  assert.deepEqual(query.where, { userId: "owner" });
  assert.equal(query.skip, 1);
  assert.equal(query.take, 2);
  assert.deepEqual(query.orderBy, [{ occurredAt: "desc" }, { id: "desc" }]);
  assert.equal(result.hasMore, true);
  assert.equal(result.events[0].reversedByEventId, null);
  assert.equal(result.events[0].replacedByEventId, null);
});

test("event history rejects pagination offsets Prisma cannot represent", async () => {
  let queried = false;
  await assert.rejects(
    listOwnedPortfolioEvents(
      {
        portfolioEvent: {
          async findMany() {
            queried = true;
            return [];
          },
        },
      },
      "owner",
      { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
    ),
    (error) =>
      error.code === "INVALID_INPUT" &&
      /outside the supported range/i.test(error.message),
  );
  assert.equal(queried, false);
});

test("transaction position catalog is owner-scoped and includes exact zero and archived balances", async () => {
  const traces = [];
  const client = {
    async $transaction(operation, options) {
      traces.push(["transaction", options.isolationLevel]);
      const transaction = {
        async $queryRaw(_strings, userId) {
          traces.push(["user", userId]);
          return [{ ledgerAdoptedAt: new Date("2026-08-20T12:00:00Z") }];
        },
        user: {
          async findUnique(args) {
            traces.push(["user", args.where.id]);
            return { ledgerAdoptedAt: new Date("2026-08-20T12:00:00Z") };
          },
        },
        userAsset: {
          async findMany(args) {
            traces.push(["positions", args.where.userId]);
            return [
              {
                id: "btc",
                assetId: "bitcoin",
                assetName: "BTC",
                archivedAt: null,
              },
              {
                id: "eth-zero",
                assetId: "ethereum",
                assetName: "ETH old",
                archivedAt: new Date("2026-08-21T00:00:00Z"),
              },
            ];
          },
        },
        assetMovement: {
          async groupBy(args) {
            traces.push(["movements", args.where.userId]);
            return [
              {
                userAssetId: "btc",
                _sum: { quantityDelta: new Prisma.Decimal("1.250000") },
              },
              {
                userAssetId: "eth-zero",
                _sum: { quantityDelta: new Prisma.Decimal("0") },
              },
              {
                userAssetId: "other-user-position",
                _sum: { quantityDelta: new Prisma.Decimal("999") },
              },
            ];
          },
        },
      };
      return operation(transaction);
    },
  };

  const catalog = await listOwnedTransactionPositions(client, "owner");
  assert.deepEqual(
    catalog.positions.map(({ id, balance, canSpend }) => ({
      id,
      balance,
      canSpend,
    })),
    [
      { id: "btc", balance: "1.25", canSpend: true },
      { id: "eth-zero", balance: "0", canSpend: false },
    ],
  );
  assert.deepEqual(traces, [
    ["transaction", "RepeatableRead"],
    ["user", "owner"],
    ["positions", "owner"],
    ["movements", "owner"],
  ]);
});

test("transaction position catalog is empty before ledger adoption", async () => {
  let queriedPositions = false;
  const catalog = await listOwnedTransactionPositions(
    {
      $transaction(operation) {
        return operation({
          async $queryRaw() {
            return [{ ledgerAdoptedAt: null }];
          },
          user: {
            async findUnique() {
              return { ledgerAdoptedAt: null };
            },
          },
          userAsset: {
            async findMany() {
              queriedPositions = true;
              return [];
            },
          },
          assetMovement: {
            async groupBy() {
              return [];
            },
          },
        });
      },
    },
    "legacy-owner",
  );
  assert.deepEqual(catalog, { ledgerAdopted: false, positions: [] });
  assert.equal(queriedPositions, false);
});

test("transaction position catalog keeps minimum-scale balances plain", async () => {
  const catalog = await listOwnedTransactionPositions(
    {
      $transaction(operation) {
        return operation({
          async $queryRaw() {
            return [{ ledgerAdoptedAt: new Date("2026-08-20T12:00:00Z") }];
          },
          user: {
            async findUnique() {
              return { ledgerAdoptedAt: new Date("2026-08-20T12:00:00Z") };
            },
          },
          userAsset: {
            async findMany() {
              return [
                {
                  id: "tiny",
                  assetId: "tiny-coin",
                  assetName: "Tiny",
                  archivedAt: null,
                },
              ];
            },
          },
          assetMovement: {
            async groupBy() {
              return [
                {
                  userAssetId: "tiny",
                  _sum: { quantityDelta: new Prisma.Decimal("1e-30") },
                },
              ];
            },
          },
        });
      },
    },
    "owner",
  );

  assert.equal(
    catalog.positions[0].balance,
    "0.000000000000000000000000000001",
  );
  assert.equal(catalog.positions[0].canSpend, true);
});
