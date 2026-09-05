import assert from "node:assert/strict";
import test from "node:test";
import {
  correctTransaction,
  deterministicPositionId,
  recordTransaction,
  reverseTransaction,
} from "../src/services/portfolio-transactions/service.ts";
import { createPostgresTransactionStore } from "../src/services/portfolio-transactions/postgres.ts";

const ownerId = "auth0|owner";
const otherId = "auth0|other";
const adoption = new Date("2026-08-20T12:00:00.000Z");
const now = new Date("2026-08-22T12:00:00.000Z");

const keys = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005",
];

function clone(value) {
  return structuredClone(value);
}

function openingEvent(userId, positionId, quantity) {
  return {
    id: `opening:${positionId}`,
    userId,
    kind: "OPENING_BALANCE",
    occurredAt: adoption,
    actualValueUsd: null,
    externalFlowUsd: "0",
    feeUsd: "0",
    note: null,
    idempotencyKey: `opening:v1:${positionId}`,
    reversalOfEventId: null,
    replacementForEventId: null,
    movements: [
      {
        userAssetId: positionId,
        role: "PRINCIPAL",
        quantityDelta: quantity,
        unitPriceUsd: null,
        priceEstimated: false,
      },
    ],
    createdAt: adoption,
  };
}

function createStore({ adopted = true, btc = "1", eth = "2" } = {}) {
  const state = {
    users: [
      { id: ownerId, ledgerAdoptedAt: adopted ? adoption : null },
      { id: otherId, ledgerAdoptedAt: adoption },
    ],
    positions: [
      {
        id: "btc",
        userId: ownerId,
        assetId: "bitcoin",
        assetName: "BTC",
        ledgerInitialAssetName: "BTC",
        amount: 999,
        archivedAt: null,
      },
      {
        id: "eth",
        userId: ownerId,
        assetId: "ethereum",
        assetName: "ETH",
        ledgerInitialAssetName: "ETH",
        amount: 999,
        archivedAt: null,
      },
      {
        id: "other-btc",
        userId: otherId,
        assetId: "bitcoin",
        assetName: "Other BTC",
        ledgerInitialAssetName: "Other BTC",
        amount: 1,
        archivedAt: null,
      },
    ],
    events: [
      openingEvent(ownerId, "btc", btc),
      openingEvent(ownerId, "eth", eth),
      openingEvent(otherId, "other-btc", "1"),
    ],
    flushes: 0,
  };
  let sequence = 0;
  let tail = Promise.resolve();

  const store = {
    runSerializable(operation) {
      const run = tail.then(async () => {
        const transaction = clone(state);
        const result = await operation(transaction);
        state.users = transaction.users;
        state.positions = transaction.positions;
        state.events = transaction.events;
        state.flushes = transaction.flushes;
        return clone(result);
      });
      tail = run.catch(() => undefined);
      return run;
    },
    async lockUser(transaction, userId) {
      return transaction.users.find(({ id }) => id === userId) ?? null;
    },
    async findOwnedPositions(transaction, userId, ids) {
      return transaction.positions.filter(
        (position) => position.userId === userId && ids.includes(position.id),
      );
    },
    async createPosition(transaction, { userId, seed, archivedAt }) {
      const created = {
        ...seed,
        userId,
        amount: 0,
        ledgerInitialAssetName: seed.assetName,
        archivedAt,
      };
      transaction.positions.push(created);
      return created;
    },
    async findOwnedEvent(transaction, userId, eventId) {
      return (
        transaction.events.find(
          (event) => event.id === eventId && event.userId === userId,
        ) ?? null
      );
    },
    async findOwnedEventByKey(transaction, userId, idempotencyKey) {
      return (
        transaction.events.find(
          (event) =>
            event.userId === userId && event.idempotencyKey === idempotencyKey,
        ) ?? null
      );
    },
    async findReversalFor(transaction, userId, eventId) {
      return (
        transaction.events.find(
          (event) =>
            event.userId === userId && event.reversalOfEventId === eventId,
        ) ?? null
      );
    },
    async createEvent(transaction, { userId, idempotencyKey, event }) {
      sequence += 1;
      const created = {
        ...clone(event),
        id: `event-${sequence}`,
        userId,
        idempotencyKey,
        createdAt: now,
      };
      transaction.events.push(created);
      return created;
    },
    async getTimeline(transaction, userId, positionIds) {
      return transaction.events
        .filter((event) => event.userId === userId)
        .flatMap((event) =>
          event.movements
            .filter(({ userAssetId }) => positionIds.includes(userAssetId))
            .map((movement) => ({
              eventId: event.id,
              userAssetId: movement.userAssetId,
              occurredAt: event.occurredAt,
              quantityDelta: movement.quantityDelta,
            })),
        );
    },
    async setArchivedAt(transaction, userId, positionId, archivedAt) {
      const position = transaction.positions.find(
        ({ id, userId: owner }) => id === positionId && owner === userId,
      );
      assert.ok(position);
      position.archivedAt = archivedAt;
    },
    async flushLedgerConstraints(transaction) {
      transaction.flushes += 1;
    },
  };

  return { store, state };
}

function buy(overrides = {}) {
  return {
    kind: "BUY",
    occurredAt: "2026-08-21T12:00:00.000Z",
    idempotencyKey: keys[0],
    position: { userAssetId: "btc", quantity: "0.5" },
    actualValueUsd: "100",
    ...overrides,
  };
}

function sell(quantity, overrides = {}) {
  return {
    kind: "SELL",
    occurredAt: "2026-08-21T12:00:00.000Z",
    idempotencyKey: keys[0],
    position: { userAssetId: "btc", quantity },
    actualValueUsd: "100",
    ...overrides,
  };
}

function asReplacement(intent) {
  const { idempotencyKey: _discarded, ...replacement } = intent;
  return replacement;
}

test("record requires adoption and owner-scoped positions", async () => {
  const legacy = createStore({ adopted: false });
  await assert.rejects(
    recordTransaction(legacy.store, ownerId, buy(), now),
    (error) => error.code === "NOT_ADOPTED",
  );

  const fixture = createStore();
  await assert.rejects(
    recordTransaction(
      fixture.store,
      ownerId,
      buy({ position: { userAssetId: "other-btc", quantity: "1" } }),
      now,
    ),
    (error) => error.code === "NOT_OWNED",
  );
  assert.equal(fixture.state.events.length, 3);
});

test("inbound transactions atomically create deterministic zero-seeded positions", async () => {
  const fixture = createStore();
  const request = buy({
    position: {
      newPosition: { assetId: "solana", assetName: "SOL cold wallet" },
      quantity: "3",
    },
  });
  const expectedId = deterministicPositionId(ownerId, keys[0], "principal");

  const event = await recordTransaction(fixture.store, ownerId, request, now);
  const created = fixture.state.positions.find(({ id }) => id === expectedId);
  assert.ok(created);
  assert.equal(created.amount, 0);
  assert.equal(created.archivedAt, null);
  assert.equal(event.movements[0].userAssetId, expectedId);

  const retry = await recordTransaction(fixture.store, ownerId, request, now);
  assert.equal(retry.id, event.id);
  assert.equal(
    fixture.state.positions.filter(({ id }) => id === expectedId).length,
    1,
  );
  fixture.state.positions.find(({ id }) => id === expectedId).assetName =
    "SOL renamed after recording";
  assert.equal(
    (await recordTransaction(fixture.store, ownerId, request, now)).id,
    event.id,
  );
  await assert.rejects(
    recordTransaction(
      fixture.store,
      ownerId,
      buy({
        position: {
          newPosition: { assetId: "solana", assetName: "Different alias" },
          quantity: "3",
        },
      }),
      now,
    ),
    (error) => error.code === "DUPLICATE_KEY",
  );
});

test("outgoing and fee legs cannot smuggle a new position", async () => {
  const fixture = createStore();
  const newPosition = {
    newPosition: { assetId: "solana", assetName: "SOL" },
    quantity: "1",
  };
  await assert.rejects(
    recordTransaction(
      fixture.store,
      ownerId,
      sell("1", { position: newPosition }),
      now,
    ),
    (error) => error.code === "INVALID_INPUT",
  );
  await assert.rejects(
    recordTransaction(
      fixture.store,
      ownerId,
      buy({ fee: { ...newPosition, valueUsd: "1" } }),
      now,
    ),
    (error) => error.code === "INVALID_INPUT",
  );
});

test("outgoing and fee legs require an existing positive position", async () => {
  const fixture = createStore({ eth: "0" });
  await assert.rejects(
    recordTransaction(
      fixture.store,
      ownerId,
      sell("0.1", {
        position: { userAssetId: "eth", quantity: "0.1" },
      }),
      now,
    ),
    (error) => error.code === "NEGATIVE_BALANCE",
  );
  await assert.rejects(
    recordTransaction(
      fixture.store,
      ownerId,
      buy({
        fee: { userAssetId: "eth", quantity: "0.01", valueUsd: "1" },
      }),
      now,
    ),
    (error) => error.code === "NEGATIVE_BALANCE",
  );
});

test("a failing swap rolls back its deterministic destination position", async () => {
  const fixture = createStore({ btc: "0.1" });
  const idempotencyKey = keys[2];
  const destinationId = deterministicPositionId(
    ownerId,
    idempotencyKey,
    "swap-destination",
  );
  await assert.rejects(
    recordTransaction(
      fixture.store,
      ownerId,
      {
        kind: "SWAP",
        occurredAt: "2026-08-21T12:00:00.000Z",
        idempotencyKey,
        from: { userAssetId: "btc", quantity: "1" },
        to: {
          newPosition: { assetId: "solana", assetName: "SOL" },
          quantity: "20",
        },
      },
      now,
    ),
    (error) => error.code === "NEGATIVE_BALANCE",
  );
  assert.equal(
    fixture.state.positions.some(({ id }) => id === destinationId),
    false,
  );
});

test("record is idempotent, rejects key reuse, and freezes legacy amount", async () => {
  const fixture = createStore();
  const first = await recordTransaction(fixture.store, ownerId, buy(), now);
  const retry = await recordTransaction(fixture.store, ownerId, buy(), now);

  assert.equal(retry.id, first.id);
  assert.equal(fixture.state.events.length, 4);
  assert.equal(
    fixture.state.positions.find(({ id }) => id === "btc").amount,
    999,
  );
  await assert.rejects(
    recordTransaction(
      fixture.store,
      ownerId,
      buy({ position: { userAssetId: "btc", quantity: "0.6" } }),
      now,
    ),
    (error) => error.code === "DUPLICATE_KEY",
  );
  assert.equal(fixture.state.events.length, 4);
});

test("current and backdated negative balances roll back completely", async () => {
  const current = createStore({ btc: "0.5" });
  await assert.rejects(
    recordTransaction(current.store, ownerId, sell("1"), now),
    (error) => error.code === "NEGATIVE_BALANCE",
  );
  assert.equal(current.state.events.length, 3);

  const backdated = createStore({ btc: "0.5" });
  await recordTransaction(
    backdated.store,
    ownerId,
    buy({
      idempotencyKey: keys[1],
      occurredAt: "2026-08-21T15:00:00.000Z",
      position: { userAssetId: "btc", quantity: "1" },
    }),
    now,
  );
  await assert.rejects(
    recordTransaction(
      backdated.store,
      ownerId,
      sell("1", {
        idempotencyKey: keys[2],
        occurredAt: "2026-08-21T13:00:00.000Z",
      }),
      now,
    ),
    (error) => error.code === "NEGATIVE_BALANCE",
  );
  assert.equal(backdated.state.events.length, 4);
});

test("concurrent spends serialize so only one can consume the balance", async () => {
  const fixture = createStore({ btc: "1" });
  const results = await Promise.allSettled([
    recordTransaction(
      fixture.store,
      ownerId,
      sell("0.75", { idempotencyKey: keys[0] }),
      now,
    ),
    recordTransaction(
      fixture.store,
      ownerId,
      sell("0.75", { idempotencyKey: keys[1] }),
      now,
    ),
  ]);

  assert.deepEqual(results.map(({ status }) => status).sort(), [
    "fulfilled",
    "rejected",
  ]);
  assert.equal(fixture.state.events.length, 4);
});

test("an invalid swap rolls back both principal legs", async () => {
  const fixture = createStore({ btc: "0.1", eth: "2" });
  await assert.rejects(
    recordTransaction(
      fixture.store,
      ownerId,
      {
        kind: "SWAP",
        occurredAt: "2026-08-21T12:00:00.000Z",
        idempotencyKey: keys[0],
        from: { userAssetId: "btc", quantity: "0.2" },
        to: { userAssetId: "eth", quantity: "3" },
      },
      now,
    ),
    (error) => error.code === "NEGATIVE_BALANCE",
  );
  assert.equal(fixture.state.events.length, 3);
});

test("zero positions archive and a later valid event restores them", async () => {
  const fixture = createStore({ btc: "1" });
  await recordTransaction(fixture.store, ownerId, sell("1"), now);
  assert.ok(fixture.state.positions.find(({ id }) => id === "btc").archivedAt);

  await recordTransaction(
    fixture.store,
    ownerId,
    buy({ idempotencyKey: keys[1] }),
    now,
  );
  assert.equal(
    fixture.state.positions.find(({ id }) => id === "btc").archivedAt,
    null,
  );
});

test("reversal is single-use and correction writes an auditable atomic pair", async () => {
  const reversed = createStore({ btc: "1" });
  const original = await recordTransaction(
    reversed.store,
    ownerId,
    sell("0.25"),
    now,
  );
  const reversal = await reverseTransaction(
    reversed.store,
    ownerId,
    original.id,
    keys[1],
    now,
  );
  assert.equal(reversal.reversalOfEventId, original.id);
  const reversalRetry = await reverseTransaction(
    reversed.store,
    ownerId,
    original.id,
    keys[1],
    now,
  );
  assert.equal(reversalRetry.id, reversal.id);
  await assert.rejects(
    reverseTransaction(reversed.store, ownerId, original.id, keys[2], now),
    (error) => error.code === "ALREADY_REVERSED",
  );

  const corrected = createStore({ btc: "1" });
  const sale = await recordTransaction(
    corrected.store,
    ownerId,
    sell("1"),
    now,
  );
  const correction = {
    eventId: sale.id,
    idempotencyKey: keys[1],
    replacement: asReplacement(
      sell("0.4", {
        idempotencyKey: keys[4],
        occurredAt: "2026-08-21T12:00:00.000Z",
      }),
    ),
  };
  const result = await correctTransaction(
    corrected.store,
    ownerId,
    correction,
    now,
  );
  const correctionRetry = await correctTransaction(
    corrected.store,
    ownerId,
    correction,
    now,
  );
  assert.equal(result.reversal.reversalOfEventId, sale.id);
  assert.equal(result.replacement.replacementForEventId, sale.id);
  assert.equal(result.replacement.kind, sale.kind);
  assert.equal(correctionRetry.reversal.id, result.reversal.id);
  assert.equal(correctionRetry.replacement.id, result.replacement.id);
  assert.equal(
    corrected.state.positions.find(({ id }) => id === "btc").archivedAt,
    null,
  );
});

test("a correction that creates a negative boundary rolls back reversal and replacement", async () => {
  const fixture = createStore({ btc: "1" });
  const sale = await recordTransaction(
    fixture.store,
    ownerId,
    sell("0.5"),
    now,
  );
  const before = fixture.state.events.length;
  await assert.rejects(
    correctTransaction(
      fixture.store,
      ownerId,
      {
        eventId: sale.id,
        idempotencyKey: keys[1],
        replacement: asReplacement(
          sell("1.5", {
            idempotencyKey: keys[4],
            occurredAt: "2026-08-21T12:00:00.000Z",
          }),
        ),
      },
      now,
    ),
    (error) => error.code === "NEGATIVE_BALANCE",
  );
  assert.equal(fixture.state.events.length, before);
  assert.equal(
    fixture.state.events.filter(
      ({ reversalOfEventId }) => reversalOfEventId === sale.id,
    ).length,
    0,
  );
});

test("corrections can deterministically create inbound positions and roll them back on failure", async () => {
  const successful = createStore();
  const purchase = await recordTransaction(
    successful.store,
    ownerId,
    buy({ position: { userAssetId: "btc", quantity: "0.5" } }),
    now,
  );
  const correctionKey = keys[1];
  const expectedId = deterministicPositionId(
    ownerId,
    `replace:${correctionKey}`,
    "principal",
  );
  const correction = {
    eventId: purchase.id,
    idempotencyKey: correctionKey,
    replacement: asReplacement(
      buy({
        occurredAt: "2026-08-21T13:00:00.000Z",
        position: {
          newPosition: { assetId: "solana", assetName: "SOL corrected" },
          quantity: "3",
        },
      }),
    ),
  };
  const result = await correctTransaction(
    successful.store,
    ownerId,
    correction,
    now,
  );
  assert.equal(result.replacement.movements[0].userAssetId, expectedId);
  assert.equal(
    successful.state.positions.find(({ id }) => id === expectedId).archivedAt,
    null,
  );
  assert.equal(
    (await correctTransaction(successful.store, ownerId, correction, now))
      .replacement.id,
    result.replacement.id,
  );

  const failing = createStore({ btc: "1", eth: "1" });
  const swap = await recordTransaction(
    failing.store,
    ownerId,
    {
      kind: "SWAP",
      occurredAt: "2026-08-21T12:00:00.000Z",
      idempotencyKey: keys[0],
      from: { userAssetId: "btc", quantity: "0.5" },
      to: { userAssetId: "eth", quantity: "1" },
    },
    now,
  );
  const failingKey = keys[2];
  const rolledBackId = deterministicPositionId(
    ownerId,
    `replace:${failingKey}`,
    "swap-destination",
  );
  await assert.rejects(
    correctTransaction(
      failing.store,
      ownerId,
      {
        eventId: swap.id,
        idempotencyKey: failingKey,
        replacement: {
          kind: "SWAP",
          occurredAt: "2026-08-21T13:00:00.000Z",
          from: { userAssetId: "btc", quantity: "2" },
          to: {
            newPosition: { assetId: "solana", assetName: "SOL failed" },
            quantity: "20",
          },
        },
      },
      now,
    ),
    (error) => error.code === "NEGATIVE_BALANCE",
  );
  assert.equal(
    failing.state.positions.some(({ id }) => id === rolledBackId),
    false,
  );
});

test("the PostgreSQL adapter bounds serializable retries", async () => {
  const calls = [];
  const client = {
    async $transaction(operation, options) {
      calls.push(options);
      if (calls.length < 3) throw { code: "P2034" };
      return operation({});
    },
  };
  const store = createPostgresTransactionStore(client);
  assert.equal(
    await store.runSerializable(async () => "committed"),
    "committed",
  );
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every(({ isolationLevel }) => isolationLevel === "Serializable"),
  );

  let exhausted = 0;
  const failing = createPostgresTransactionStore({
    async $transaction() {
      exhausted += 1;
      throw { code: "P2034" };
    },
  });
  await assert.rejects(failing.runSerializable(async () => null));
  assert.equal(exhausted, 3);
});
