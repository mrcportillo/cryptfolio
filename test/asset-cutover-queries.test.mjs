import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  findOwnedAssetForRead,
  listOwnedAssetHistoryForRead,
  readPortfolioHome,
} from "../src/services/asset/cutover-queries.ts";
import { addDecimals } from "../src/services/portfolio-transactions/decimal.ts";

function fixture({ adopted, extraPositions = [], extraEvents = [] }) {
  const metrics = { transactions: 0, isolationLevels: [] };
  const owner = "auth0|owner";
  const other = "auth0|other";
  const positions = [
    {
      id: "btc-a",
      userId: owner,
      assetId: "bitcoin",
      assetName: "BTC A",
      amount: 999,
      date: new Date("2026-08-20T10:00:00.000Z"),
      archivedAt: null,
    },
    {
      id: "btc-b",
      userId: owner,
      assetId: "bitcoin",
      assetName: "BTC B",
      amount: 888,
      date: new Date("2026-08-20T11:00:00.000Z"),
      archivedAt: new Date("2026-08-21T00:00:00.000Z"),
    },
    {
      id: "eth",
      userId: owner,
      assetId: "ethereum",
      assetName: "ETH",
      amount: 777,
      date: new Date("2026-08-20T12:00:00.000Z"),
      archivedAt: null,
    },
    {
      id: "other-btc",
      userId: other,
      assetId: "bitcoin",
      assetName: "Other BTC",
      amount: 50,
      date: new Date("2026-08-20T12:00:00.000Z"),
      archivedAt: null,
    },
    ...extraPositions,
  ];
  const events = [
    {
      id: "opening-a",
      userId: owner,
      occurredAt: new Date("2026-08-20T12:00:00.000Z"),
      movements: [{ userId: owner, userAssetId: "btc-a", quantityDelta: "1" }],
    },
    {
      id: "buy-a",
      userId: owner,
      occurredAt: new Date("2026-08-21T12:00:00.000Z"),
      movements: [
        { userId: owner, userAssetId: "btc-a", quantityDelta: "0.25" },
      ],
    },
    {
      id: "opening-b",
      userId: owner,
      occurredAt: new Date("2026-08-20T12:00:00.000Z"),
      movements: [
        { userId: owner, userAssetId: "btc-b", quantityDelta: "0.5" },
      ],
    },
    {
      id: "sell-b",
      userId: owner,
      occurredAt: new Date("2026-08-21T12:00:00.000Z"),
      movements: [
        { userId: owner, userAssetId: "btc-b", quantityDelta: "-0.5" },
      ],
    },
    {
      id: "opening-eth",
      userId: owner,
      occurredAt: new Date("2026-08-20T12:00:00.000Z"),
      movements: [{ userId: owner, userAssetId: "eth", quantityDelta: "2" }],
    },
    {
      id: "other-opening",
      userId: other,
      occurredAt: new Date("2026-08-20T12:00:00.000Z"),
      movements: [
        { userId: other, userAssetId: "other-btc", quantityDelta: "50" },
      ],
    },
    ...extraEvents,
  ];
  const archives = [
    {
      id: "legacy-archive",
      userAssetId: "btc-a",
      amount: 0.2,
      date: new Date("2026-08-19T12:00:00.000Z"),
    },
  ];

  const transaction = {
    async $queryRaw(_strings, userId) {
      const user = await this.user.findUnique({ where: { id: userId } });
      return user ? [user] : [];
    },
    user: {
      async findUnique(args) {
        if (args.where.id === owner) {
          return {
            ledgerAdoptedAt: adopted ? new Date("2026-08-20T12:00:00Z") : null,
          };
        }
        return {
          ledgerAdoptedAt: adopted ? new Date("2026-08-20T12:00:00Z") : null,
        };
      },
    },
    userAsset: {
      async findFirst(args) {
        const result = positions.find(
          (position) =>
            position.id === args.where.id &&
            position.userId === args.where.userId,
        );
        if (!result) return null;
        return args.select
          ? Object.fromEntries(
              Object.keys(args.select).map((key) => [key, result[key]]),
            )
          : result;
      },
      async findMany(args) {
        let rows = positions.filter(
          (position) => position.userId === args.where.userId,
        );
        if (args.where.id?.in) {
          rows = rows.filter(({ id }) => args.where.id.in.includes(id));
        }
        if (args.where.assetId) {
          rows = rows.filter(({ assetId }) => assetId === args.where.assetId);
        }
        rows.sort((left, right) => right.date - left.date);
        if (args.distinct) {
          rows = Array.from(
            new Map(rows.map((row) => [row.assetId, row])).values(),
          );
        }
        if (args.skip) rows = rows.slice(args.skip);
        if (args.take) rows = rows.slice(0, args.take);
        if (args.select) {
          return rows.map((row) =>
            Object.fromEntries(
              Object.keys(args.select).map((key) => [key, row[key]]),
            ),
          );
        }
        return rows;
      },
      async count(args) {
        return positions.filter(
          (position) =>
            position.userId === args.where.userId &&
            (!args.where.assetId || position.assetId === args.where.assetId),
        ).length;
      },
      async groupBy(args) {
        const grouped = new Map();
        for (const position of positions.filter(
          ({ userId }) => userId === args.where.userId,
        )) {
          grouped.set(
            position.assetId,
            (grouped.get(position.assetId) ?? 0) + position.amount,
          );
        }
        return Array.from(grouped, ([assetId, amount]) => ({
          assetId,
          _sum: { amount },
        }));
      },
    },
    assetMovement: {
      async groupBy(args) {
        const grouped = new Map();
        for (const event of events.filter(
          ({ userId }) => userId === args.where.userId,
        )) {
          for (const movement of event.movements) {
            grouped.set(
              movement.userAssetId,
              addDecimals(
                grouped.get(movement.userAssetId) ?? "0",
                movement.quantityDelta,
              ),
            );
          }
        }
        return Array.from(grouped, ([userAssetId, quantityDelta]) => ({
          userAssetId,
          _sum: { quantityDelta: new Prisma.Decimal(quantityDelta) },
        }));
      },
      async aggregate(args) {
        let quantity = "0";
        for (const event of events.filter(
          ({ userId }) => userId === args.where.userId,
        )) {
          for (const movement of event.movements.filter(
            ({ userAssetId }) => userAssetId === args.where.userAssetId,
          )) {
            quantity = addDecimals(quantity, movement.quantityDelta);
          }
        }
        return { _sum: { quantityDelta: new Prisma.Decimal(quantity) } };
      },
    },
    assetArchive: {
      async findMany(args) {
        return archives
          .filter(({ userAssetId }) => userAssetId === args.where.userAssetId)
          .slice(args.skip, args.skip + args.take);
      },
    },
    portfolioEvent: {
      async findMany(args) {
        const positionFilter = args.where.movements.some.userAssetId;
        const requestedIds =
          typeof positionFilter === "string"
            ? [positionFilter]
            : positionFilter.in;
        const descending = args.orderBy[0].occurredAt === "desc";
        return events
          .filter(
            (event) =>
              event.userId === args.where.userId &&
              event.movements.some(
                ({ userId, userAssetId }) =>
                  userId === owner && requestedIds.includes(userAssetId),
              ),
          )
          .sort(
            (left, right) =>
              (descending
                ? right.occurredAt - left.occurredAt
                : left.occurredAt - right.occurredAt) ||
              (descending
                ? right.id.localeCompare(left.id)
                : left.id.localeCompare(right.id)),
          )
          .map((event) => ({
            id: event.id,
            occurredAt: event.occurredAt,
            movements: event.movements
              .filter(
                ({ userId, userAssetId }) =>
                  userId === args.select.movements.where.userId &&
                  (typeof args.select.movements.where.userAssetId === "string"
                    ? userAssetId === args.select.movements.where.userAssetId
                    : args.select.movements.where.userAssetId.in.includes(
                        userAssetId,
                      )),
              )
              .map((movement) => ({
                ...(args.select.movements.select.quantityDelta
                  ? {
                      quantityDelta: new Prisma.Decimal(movement.quantityDelta),
                    }
                  : {}),
                ...(args.select.movements.select.userAssetId
                  ? { userAssetId: movement.userAssetId }
                  : {}),
              })),
          }));
      },
    },
  };

  return {
    owner,
    client: {
      $transaction(operation, options) {
        metrics.transactions += 1;
        metrics.isolationLevels.push(options?.isolationLevel);
        return operation(transaction);
      },
    },
    metrics,
  };
}

test("pre-adoption reads preserve legacy amount and archive behavior", async () => {
  const { client, owner } = fixture({ adopted: false });
  const asset = await findOwnedAssetForRead(client, owner, "btc-a");
  const home = await readPortfolioHome(client, owner, {
    page: 1,
    pageSize: 10,
  });
  const history = await listOwnedAssetHistoryForRead(
    client,
    owner,
    "btc-a",
    10,
    1,
  );
  assert.equal(asset.amount, "999");
  assert.equal(home.assetsPage.ledgerAdopted, false);
  assert.deepEqual(
    home.assetsPage.assets.map(({ id, amount }) => ({ id, amount })),
    [
      { id: "eth", amount: "777" },
      { id: "btc-b", amount: "888" },
      { id: "btc-a", amount: "999" },
    ],
  );
  assert.deepEqual(home.coinIds.sort(), ["bitcoin", "ethereum"]);
  assert.deepEqual(
    home.holdings.sort((left, right) =>
      left.assetId.localeCompare(right.assetId),
    ),
    [
      { assetId: "bitcoin", amount: "1887" },
      { assetId: "ethereum", amount: "777" },
    ],
  );
  assert.deepEqual(
    history.map(({ id }) => id),
    ["legacy-archive"],
  );
});

test("post-adoption reads use exact movement sums and suppress zero positions", async () => {
  const { client, owner } = fixture({ adopted: true });
  const home = await readPortfolioHome(client, owner, {
    page: 1,
    pageSize: 10,
  });
  const asset = await findOwnedAssetForRead(client, owner, "btc-a");

  assert.deepEqual(
    home.assetsPage.assets.map(({ id, amount }) => ({ id, amount })),
    [
      { id: "btc-a", amount: "1.25" },
      { id: "eth", amount: "2" },
    ],
  );
  assert.equal(home.assetsPage.total, 2);
  assert.equal(home.assetsPage.ledgerAdopted, true);
  assert.equal(asset.amount, "1.25");
  assert.equal(asset.date.toISOString(), "2026-08-21T12:00:00.000Z");
  assert.equal(
    home.assetsPage.assets[0].date.toISOString(),
    "2026-08-21T12:00:00.000Z",
  );
  assert.notEqual(asset.amount, "999");
});

test("coin aggregation combines positions only at the existing portfolio boundary", async () => {
  const { client, owner } = fixture({ adopted: true });
  const { holdings } = await readPortfolioHome(client, owner, {
    page: 1,
    pageSize: 10,
  });
  assert.deepEqual(
    holdings.sort((left, right) => left.assetId.localeCompare(right.assetId)),
    [
      { assetId: "bitcoin", amount: "1.25" },
      { assetId: "ethereum", amount: "2" },
    ],
  );
});

test("post-adoption history comes from ledger boundaries, never AssetArchive", async () => {
  const { client, owner } = fixture({ adopted: true });
  const history = await listOwnedAssetHistoryForRead(
    client,
    owner,
    "btc-a",
    10,
    1,
  );
  assert.deepEqual(
    history.map(({ id, amount }) => ({ id, amount })),
    [
      { id: "ledger:opening-a", amount: "1" },
      { id: "ledger:buy-a", amount: "1.25" },
    ],
  );
  assert.ok(history.every(({ id }) => id !== "legacy-archive"));
});

test("home data comes from one repeatable-read snapshot boundary", async () => {
  const { client, owner, metrics } = fixture({ adopted: true });
  const result = await readPortfolioHome(client, owner, {
    page: 1,
    pageSize: 10,
  });

  assert.equal(metrics.transactions, 1);
  assert.deepEqual(metrics.isolationLevels, ["RepeatableRead"]);
  assert.equal(
    result.ledgerAdoptedAt.toISOString(),
    "2026-08-20T12:00:00.000Z",
  );
  assert.deepEqual(
    result.assetsPage.assets.map(({ id, amount }) => ({ id, amount })),
    [
      { id: "btc-a", amount: "1.25" },
      { id: "eth", amount: "2" },
    ],
  );
  assert.deepEqual(result.coinIds.sort(), ["bitcoin", "ethereum"]);
  assert.deepEqual(
    result.holdings.sort((left, right) =>
      left.assetId.localeCompare(right.assetId),
    ),
    [
      { assetId: "bitcoin", amount: "1.25" },
      { assetId: "ethereum", amount: "2" },
    ],
  );
});

test("adopted read models preserve minimum-scale and large exact quantities", async () => {
  const large =
    "12345678901234567890123456789012345.123456789012345678901234567888";
  const tiny = "0.000000000000000000000000000001";
  const combined =
    "12345678901234567890123456789012345.123456789012345678901234567889";
  const owner = "auth0|owner";
  const { client } = fixture({
    adopted: true,
    extraPositions: [
      {
        id: "precision-large",
        userId: owner,
        assetId: "precision-coin",
        assetName: "Precision large",
        amount: 0,
        date: new Date("2026-08-20T13:00:00.000Z"),
        archivedAt: null,
      },
      {
        id: "precision-tiny",
        userId: owner,
        assetId: "precision-coin",
        assetName: "Precision tiny",
        amount: 0,
        date: new Date("2026-08-20T14:00:00.000Z"),
        archivedAt: null,
      },
    ],
    extraEvents: [
      {
        id: "opening-precision-large",
        userId: owner,
        occurredAt: new Date("2026-08-20T13:00:00.000Z"),
        movements: [
          {
            userId: owner,
            userAssetId: "precision-large",
            quantityDelta: large,
          },
        ],
      },
      {
        id: "opening-precision-tiny",
        userId: owner,
        occurredAt: new Date("2026-08-20T14:00:00.000Z"),
        movements: [
          {
            userId: owner,
            userAssetId: "precision-tiny",
            quantityDelta: tiny,
          },
        ],
      },
    ],
  });

  const [asset, home, history] = await Promise.all([
    findOwnedAssetForRead(client, owner, "precision-tiny"),
    readPortfolioHome(client, owner, {
      page: 1,
      pageSize: 10,
      assetId: "precision-coin",
    }),
    listOwnedAssetHistoryForRead(client, owner, "precision-large", 10, 1),
  ]);

  assert.equal(asset.amount, tiny);
  assert.deepEqual(
    home.assetsPage.assets.map(({ amount }) => amount).sort(),
    [large, tiny].sort(),
  );
  assert.equal(
    home.holdings.find(({ assetId }) => assetId === "precision-coin").amount,
    combined,
  );
  assert.equal(history[0].amount, large);
});

test("foreign owners cannot read positions or history", async () => {
  const { client } = fixture({ adopted: true });
  assert.equal(
    await findOwnedAssetForRead(client, "auth0|attacker", "btc-a"),
    null,
  );
  assert.deepEqual(
    await listOwnedAssetHistoryForRead(
      client,
      "auth0|attacker",
      "btc-a",
      10,
      1,
    ),
    [],
  );
});
