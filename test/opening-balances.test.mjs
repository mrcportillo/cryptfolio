import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalDecimal,
  openingFingerprintV1,
  parseOpeningBalanceArguments,
  prepareLegacyPositions,
  runOpeningBalanceConversion,
  verifyOpeningRecords,
} from "../scripts/portfolio-ledger/opening-balances-lib.mjs";
import { createPostgresOpeningBalanceStore } from "../scripts/portfolio-ledger/opening-balances.mjs";

const adoptionAt = "2026-08-21T03:00:00.000Z";
const ownerId = "auth0|owner";

function clone(value) {
  return structuredClone(value);
}

function createFakeStore({
  users,
  positions,
  archives = [],
  failOnCreate = null,
}) {
  const state = {
    users: clone(users),
    positions: clone(positions),
    archives: clone(archives),
    events: [],
    movements: [],
  };
  const calls = [];
  let created = 0;

  function recordsFor(transaction, userId) {
    const events = transaction.events
      .filter(
        (event) => event.userId === userId && event.kind === "OPENING_BALANCE",
      )
      .sort((left, right) => left.id.localeCompare(right.id));

    return events.flatMap((event) => {
      const movements = transaction.movements.filter(
        (movement) =>
          movement.portfolioEventId === event.id &&
          movement.userId === event.userId,
      );
      const rows = movements.length ? movements : [null];

      return rows.map((movement) => ({
        eventId: event.id,
        eventUserId: event.userId,
        kind: event.kind,
        occurredAtText: event.occurredAt,
        externalFlowUsdText: event.externalFlowUsd,
        feeUsdText: event.feeUsd,
        idempotencyKey: event.idempotencyKey,
        openingForUserAssetId: event.openingForUserAssetId,
        movementId: movement?.id ?? null,
        movementUserId: movement?.userId ?? null,
        movementUserAssetId: movement?.userAssetId ?? null,
        movementRole: movement?.role ?? null,
        quantityDeltaText: movement?.quantityDelta ?? null,
        unitPriceUsdText: movement?.unitPriceUsd ?? null,
        priceEstimated: movement?.priceEstimated ?? null,
      }));
    });
  }

  const store = {
    async runSerializable(operation) {
      calls.push("transaction:serializable");
      const transaction = clone(state);
      const result = await operation(transaction);
      Object.assign(state, transaction);
      return result;
    },

    async getUser(transaction, userId) {
      calls.push(`user:read:${userId}`);
      return transaction.users.find((user) => user.id === userId) ?? null;
    },

    async lockUser(transaction, userId) {
      calls.push(`user:advisory-and-row-lock:${userId}`);
      return transaction.users.find((user) => user.id === userId) ?? null;
    },

    async getLegacyPositions(transaction, userId, { lock }) {
      calls.push(`positions:${lock ? "lock" : "read"}:${userId}`);
      return transaction.positions
        .filter((position) => position.userId === userId)
        .map((position) => ({
          ...position,
          assetName: position.ledgerInitialAssetName ?? position.assetName,
        }));
    },

    async createOpening(
      transaction,
      { userId, adoptionAt: occurredAt, position },
    ) {
      created += 1;
      calls.push(`opening:create:${position.id}`);
      if (created === failOnCreate) {
        throw new Error("injected opening failure");
      }

      let event = transaction.events.find(
        (candidate) =>
          candidate.userId === userId &&
          candidate.idempotencyKey === position.idempotencyKey,
      );

      if (!event) {
        event = {
          id: `event-${position.id}`,
          userId,
          kind: "OPENING_BALANCE",
          occurredAt,
          externalFlowUsd: "0.000000000000000000000000000000",
          feeUsd: "0.000000000000000000000000000000",
          idempotencyKey: position.idempotencyKey,
          openingForUserAssetId: position.id,
        };
        transaction.events.push(event);
      }

      const movementId = `opening-movement:${event.id}`;
      if (
        !transaction.movements.some((movement) => movement.id === movementId)
      ) {
        transaction.movements.push({
          id: movementId,
          userId,
          portfolioEventId: event.id,
          userAssetId: position.id,
          role: "PRINCIPAL",
          quantityDelta: position.quantity,
          unitPriceUsd: null,
          priceEstimated: false,
        });
      }
    },

    async getOpeningRecords(transaction, userId) {
      calls.push(`opening:verify:${userId}`);
      return recordsFor(transaction, userId);
    },

    async flushOpeningConstraints() {
      calls.push("opening:constraints:flush");
    },

    async getOpeningQuantities(transaction, userId, positionIds) {
      calls.push(`quantities:verify:${userId}`);
      const openingEventIds = new Set(
        transaction.events
          .filter(
            (event) =>
              event.userId === userId && event.kind === "OPENING_BALANCE",
          )
          .map(({ id }) => id),
      );
      return transaction.positions
        .filter(
          (legacyPosition) =>
            legacyPosition.userId === userId &&
            positionIds.includes(legacyPosition.id),
        )
        .map((legacyPosition) => {
          const movements = transaction.movements.filter(
            (movement) =>
              movement.userId === userId &&
              movement.userAssetId === legacyPosition.id &&
              openingEventIds.has(movement.portfolioEventId),
          );
          assert.ok(movements.length <= 1, "fake expects at most one movement");
          return {
            userAssetId: legacyPosition.id,
            userId,
            quantityText: movements[0]?.quantityDelta ?? "0",
          };
        });
    },

    async markLedgerAdopted(transaction, userId, timestamp) {
      calls.push(`user:mark-adopted:${userId}`);
      const user = transaction.users.find(
        (candidate) => candidate.id === userId,
      );
      if (!user || user.ledgerAdoptedAt) {
        return null;
      }
      for (const legacyPosition of transaction.positions.filter(
        ({ userId: owner }) => owner === userId,
      )) {
        legacyPosition.ledgerInitialAssetName = legacyPosition.assetName;
      }
      user.ledgerAdoptedAt = timestamp;
      return user;
    },
  };

  return { state, calls, store };
}

function position({
  id,
  userId = ownerId,
  amountText,
  assetId = "bitcoin",
  assetName = `Position ${id}`,
  dateText = "2026-08-20T12:00:00.000Z",
}) {
  return { id, userId, assetId, assetName, amountText, dateText };
}

test("opening-balance arguments are dry-run-first and gate apply mode", () => {
  assert.deepEqual(parseOpeningBalanceArguments(["--", "--user-id", ownerId]), {
    apply: false,
    help: false,
    userId: ownerId,
    adoptionAt: null,
    expectedFingerprint: null,
  });

  assert.throws(
    () => parseOpeningBalanceArguments(["--user-id", ownerId, "--apply"]),
    /requires a fixed --adoption-at/,
  );
  assert.throws(
    () =>
      parseOpeningBalanceArguments([
        "--user-id",
        ownerId,
        "--apply",
        "--adoption-at",
        adoptionAt,
      ]),
    /requires --expected-fingerprint/,
  );
  assert.throws(
    () =>
      parseOpeningBalanceArguments([
        "--user-id",
        ownerId,
        "--adoption-at",
        "2026-08-21T03:00:00Z",
      ]),
    /exact UTC ISO timestamp/,
  );
});

test("PostgreSQL store retries serializable conflicts without widening isolation", async () => {
  const calls = [];
  const client = {
    async $transaction(operation, options) {
      calls.push(options);
      if (calls.length === 1) {
        throw Object.assign(new Error("write conflict"), { code: "P2034" });
      }
      return operation({ transaction: true });
    },
  };
  const store = createPostgresOpeningBalanceStore(client);

  const result = await store.runSerializable(
    async (transaction) => transaction,
  );

  assert.deepEqual(result, { transaction: true });
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every(({ isolationLevel }) => isolationLevel === "Serializable"),
  );
});

test("decimal conversion preserves exact text without a JavaScript number", () => {
  assert.equal(canonicalDecimal("0.12345678901234567"), "0.12345678901234567");
  assert.equal(canonicalDecimal("1e-8"), "0.00000001");
  assert.equal(
    canonicalDecimal("1e+34"),
    "10000000000000000000000000000000000",
  );
  assert.equal(canonicalDecimal("-0"), "0");
  assert.throws(() => canonicalDecimal("NaN"), /not finite decimal text/);
  assert.throws(() => canonicalDecimal("1e-31"), /fractional digits/);
  assert.throws(() => canonicalDecimal("1e+35"), /integer digits/);
});

test("dry run reports exact openings and writes nothing", async () => {
  const fixture = createFakeStore({
    users: [
      { id: ownerId, ledgerAdoptedAt: null },
      { id: "auth0|other", ledgerAdoptedAt: null },
    ],
    positions: [
      position({ id: "btc", amountText: "0.12345678901234567" }),
      position({ id: "zero", amountText: "0" }),
      position({ id: "other", userId: "auth0|other", amountText: "99" }),
    ],
    archives: [{ id: "archive-1", userAssetId: "btc", amountText: "0.1" }],
  });
  const before = clone(fixture.state);

  const result = await runOpeningBalanceConversion({
    store: fixture.store,
    userId: ownerId,
    adoptionAt,
  });

  assert.equal(result.mode, "dry-run");
  assert.equal(result.openingCount, 1);
  assert.equal(result.skippedZeroCount, 1);
  assert.match(result.legacyFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(fixture.state, before);
  assert.ok(!fixture.calls.some((call) => call.startsWith("opening:create")));
  assert.ok(
    !fixture.calls.some((call) => call.startsWith("user:mark-adopted")),
  );
});

test("apply creates one exact opening per positive owned position and marks adoption last", async () => {
  const fixture = createFakeStore({
    users: [
      { id: ownerId, ledgerAdoptedAt: null },
      { id: "auth0|other", ledgerAdoptedAt: null },
    ],
    positions: [
      position({ id: "btc", amountText: "0.12345678901234567" }),
      position({ id: "eth", amountText: "1e-8", assetId: "ethereum" }),
      position({ id: "zero", amountText: "0" }),
      position({ id: "other", userId: "auth0|other", amountText: "99" }),
    ],
    archives: [{ id: "archive-1", userAssetId: "btc", amountText: "0.1" }],
  });
  const legacyBefore = clone(fixture.state.positions);
  const archivesBefore = clone(fixture.state.archives);
  const dryRun = await runOpeningBalanceConversion({
    store: fixture.store,
    userId: ownerId,
  });

  const result = await runOpeningBalanceConversion({
    store: fixture.store,
    userId: ownerId,
    adoptionAt,
    expectedFingerprint: dryRun.legacyFingerprint,
    apply: true,
  });

  assert.equal(result.alreadyApplied, false);
  assert.equal(result.openingCount, 2);
  assert.equal(fixture.state.events.length, 2);
  assert.deepEqual(
    fixture.state.movements.map(({ userAssetId, quantityDelta }) => [
      userAssetId,
      quantityDelta,
    ]),
    [
      ["btc", "0.12345678901234567"],
      ["eth", "0.00000001"],
    ],
  );
  assert.ok(
    fixture.state.events.every(
      (event) =>
        event.externalFlowUsd.startsWith("0") && event.feeUsd.startsWith("0"),
    ),
  );
  assert.ok(
    !fixture.state.events.some(
      (event) => event.openingForUserAssetId === "zero",
    ),
  );
  assert.ok(
    !fixture.state.events.some((event) => event.userId === "auth0|other"),
  );
  assert.equal(
    fixture.state.users.find((user) => user.id === ownerId).ledgerAdoptedAt,
    adoptionAt,
  );
  assert.deepEqual(
    fixture.state.positions.map(
      ({ ledgerInitialAssetName: _capturedAlias, ...legacyPosition }) =>
        legacyPosition,
    ),
    legacyBefore,
  );
  assert.ok(
    fixture.state.positions
      .filter(({ userId }) => userId === ownerId)
      .every(
        ({ assetName, ledgerInitialAssetName }) =>
          ledgerInitialAssetName === assetName,
      ),
  );
  assert.deepEqual(fixture.state.archives, archivesBefore);
  const adoptionCall = fixture.calls.indexOf(`user:mark-adopted:${ownerId}`);
  const constraintFlushCall = fixture.calls.indexOf(
    "opening:constraints:flush",
  );
  const verificationCalls = fixture.calls
    .map((call, index) => ({ call, index }))
    .filter(({ call }) => call === `opening:verify:${ownerId}`);
  assert.ok(verificationCalls[0].index < adoptionCall);
  assert.ok(verificationCalls.at(-1).index > adoptionCall);
  assert.ok(constraintFlushCall < adoptionCall);
});

test("retry is idempotent and preserves the opening fingerprint", async () => {
  const fixture = createFakeStore({
    users: [{ id: ownerId, ledgerAdoptedAt: null }],
    positions: [position({ id: "btc", amountText: "2.5" })],
  });
  const dryRun = await runOpeningBalanceConversion({
    store: fixture.store,
    userId: ownerId,
  });
  const first = await runOpeningBalanceConversion({
    store: fixture.store,
    userId: ownerId,
    adoptionAt,
    expectedFingerprint: dryRun.legacyFingerprint,
    apply: true,
  });
  fixture.state.positions[0].assetName = "Renamed after adoption";
  fixture.state.positions.push(
    position({
      id: "sol-after-adoption",
      assetId: "solana",
      amountText: "0",
      dateText: "2026-08-22T12:00:00.000Z",
    }),
  );
  fixture.state.events.push({
    id: "later-buy",
    userId: ownerId,
    kind: "BUY",
    occurredAt: "2026-08-22T12:00:00.000Z",
    idempotencyKey: "later-buy",
  });
  fixture.state.movements.push({
    id: "later-buy-movement",
    userId: ownerId,
    portfolioEventId: "later-buy",
    userAssetId: "sol-after-adoption",
    role: "PRINCIPAL",
    quantityDelta: "3",
    unitPriceUsd: null,
    priceEstimated: false,
  });
  const stateAfterFirstApply = clone(fixture.state);

  const retry = await runOpeningBalanceConversion({
    store: fixture.store,
    userId: ownerId,
    adoptionAt,
    expectedFingerprint: dryRun.legacyFingerprint,
    apply: true,
  });

  assert.equal(retry.alreadyApplied, true);
  assert.equal(retry.openingFingerprint, first.openingFingerprint);
  assert.deepEqual(fixture.state, stateAfterFirstApply);
});

test("invalid quantities and changed fingerprints abort without writes", async () => {
  for (const amountText of ["-1", "NaN", "1e-31", "1e+35"]) {
    const fixture = createFakeStore({
      users: [{ id: ownerId, ledgerAdoptedAt: null }],
      positions: [position({ id: "bad", amountText })],
    });
    await assert.rejects(
      runOpeningBalanceConversion({ store: fixture.store, userId: ownerId }),
    );
    assert.deepEqual(fixture.state.events, []);
  }

  const fixture = createFakeStore({
    users: [{ id: ownerId, ledgerAdoptedAt: null }],
    positions: [position({ id: "btc", amountText: "1" })],
  });
  const dryRun = await runOpeningBalanceConversion({
    store: fixture.store,
    userId: ownerId,
  });
  fixture.state.positions[0].amountText = "2";

  await assert.rejects(
    runOpeningBalanceConversion({
      store: fixture.store,
      userId: ownerId,
      adoptionAt,
      expectedFingerprint: dryRun.legacyFingerprint,
      apply: true,
    }),
    /Legacy fingerprint changed/,
  );
  assert.deepEqual(fixture.state.events, []);
  assert.equal(fixture.state.users[0].ledgerAdoptedAt, null);
});

test("a mid-conversion failure rolls back every opening and the adoption marker", async () => {
  const fixture = createFakeStore({
    users: [{ id: ownerId, ledgerAdoptedAt: null }],
    positions: [
      position({ id: "btc", amountText: "1" }),
      position({ id: "eth", amountText: "2", assetId: "ethereum" }),
    ],
    failOnCreate: 2,
  });
  const dryRun = await runOpeningBalanceConversion({
    store: fixture.store,
    userId: ownerId,
  });

  await assert.rejects(
    runOpeningBalanceConversion({
      store: fixture.store,
      userId: ownerId,
      adoptionAt,
      expectedFingerprint: dryRun.legacyFingerprint,
      apply: true,
    }),
    /injected opening failure/,
  );

  assert.deepEqual(fixture.state.events, []);
  assert.deepEqual(fixture.state.movements, []);
  assert.equal(fixture.state.users[0].ledgerAdoptedAt, null);
});

test("opening verification rejects cross-owner movement records", () => {
  const [ownedPosition] = prepareLegacyPositions(ownerId, [
    position({ id: "btc", amountText: "1" }),
  ]);

  assert.throws(
    () =>
      verifyOpeningRecords({
        userId: ownerId,
        adoptionAt,
        positivePositions: [ownedPosition],
        records: [
          {
            eventId: "event-btc",
            eventUserId: ownerId,
            kind: "OPENING_BALANCE",
            occurredAtText: adoptionAt,
            externalFlowUsdText: "0",
            feeUsdText: "0",
            idempotencyKey: "opening:v1:btc",
            openingForUserAssetId: "btc",
            movementId: "movement-btc",
            movementUserId: "auth0|other",
            movementUserAssetId: "btc",
            movementRole: "PRINCIPAL",
            quantityDeltaText: "1",
            unitPriceUsdText: null,
            priceEstimated: false,
          },
        ],
      }),
    /ownership boundary/,
  );
});

test("the v1 opening fingerprint deliberately remains stable across the role expansion", () => {
  const record = {
    eventId: "event-btc",
    eventUserId: ownerId,
    kind: "OPENING_BALANCE",
    occurredAtText: adoptionAt,
    externalFlowUsdText: "0",
    feeUsdText: "0",
    idempotencyKey: "opening:v1:btc",
    openingForUserAssetId: "btc",
    movementId: "movement-btc",
    movementUserId: ownerId,
    movementUserAssetId: "btc",
    movementRole: "PRINCIPAL",
    quantityDeltaText: "1",
    unitPriceUsdText: null,
    priceEstimated: false,
  };

  assert.equal(
    openingFingerprintV1([record]),
    openingFingerprintV1([{ ...record, movementRole: "FEE" }]),
  );
});

test("schema and migrations enforce ledger invariants offline", async () => {
  const [
    schema,
    baseline,
    migration,
    manualMigration,
    migrationLock,
    cli,
    preflight,
    verification,
  ] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../prisma/migrations/20260820120000_legacy_baseline/migration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../prisma/migrations/20260820121000_add_portfolio_ledger/migration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../prisma/migrations/20260820122000_add_manual_transactions/migration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../prisma/migrations/migration_lock.toml", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../scripts/portfolio-ledger/opening-balances.mjs",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../scripts/portfolio-ledger/preflight.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../scripts/portfolio-ledger/verify.sql", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(schema, /quantityDelta\s+Decimal\s+@db\.Decimal\(65, 30\)/);
  assert.match(schema, /@@unique\(\[userId, idempotencyKey\]\)/);
  assert.match(schema, /REVERSAL/);
  assert.doesNotMatch(schema, /CORRECTION/);
  assert.match(schema, /externalFlowUsd\s+Decimal\?\s+@db\.Decimal\(65, 30\)/);
  assert.match(schema, /feeUsd\s+Decimal\?\s+@db\.Decimal\(65, 30\)/);
  assert.match(
    schema,
    /reversalOf\s+PortfolioEvent\?\s+@relation\("PortfolioEventReversal", fields: \[reversalOfEventId, userId\], references: \[id, userId\], onDelete: Restrict\)/,
  );
  assert.match(schema, /@@unique\(\[reversalOfEventId, userId\]\)/);
  assert.match(
    schema,
    /ledgerInitialAssetName\s+String\?\s+@db\.VarChar\(80\)/,
  );
  assert.match(baseline, /"amount" DOUBLE PRECISION NOT NULL/);
  assert.match(baseline, /UserAsset_userId_date_idx/);
  assert.match(baseline, /AssetArchive_userAssetId_date_idx/);
  assert.match(migrationLock, /provider = "postgresql"/);
  assert.match(migration, /PortfolioEvent_opening_zero_flow_check/);
  assert.match(migration, /PortfolioEvent_reversal_shape_check/);
  assert.match(migration, /PortfolioEvent_fee_sign_check/);
  assert.match(migration, /PortfolioEvent_not_self_reversal_check/);
  assert.match(manualMigration, /PortfolioEvent_opening_actual_value_check/);
  assert.match(manualMigration, /User_ledger_adoption_boundary_guard/);
  assert.match(manualMigration, /assert_ledger_adoption_boundary/);
  assert.match(manualMigration, /AssetMovement_nonnegative_timeline_check/);
  assert.match(manualMigration, /assert_nonnegative_asset_timeline/);
  assert.match(manualMigration, /PortfolioEvent_finite_actual_value_check/);
  assert.match(manualMigration, /PortfolioEvent_finite_external_flow_check/);
  assert.match(manualMigration, /PortfolioEvent_finite_fee_check/);
  assert.match(manualMigration, /AssetMovement_finite_quantity_check/);
  assert.match(manualMigration, /AssetMovement_finite_unit_price_check/);
  assert.match(manualMigration, /PortfolioEvent_finite_occurred_at_check/);
  assert.match(manualMigration, /User_finite_ledger_adopted_at_check/);
  assert.match(manualMigration, /UserAsset_finite_archived_at_check/);
  assert.match(manualMigration, /AssetMovement_owner_write_serialization/);
  assert.match(manualMigration, /serialize_ledger_owner_write/);
  assert.match(migration, /AssetMovement_nonzero_quantity_check/);
  assert.match(
    migration,
    /FOREIGN KEY \("portfolioEventId", "userId"\).*REFERENCES "PortfolioEvent"\("id", "userId"\)/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("userAssetId", "userId"\).*REFERENCES "UserAsset"\("id", "userId"\)/,
  );
  assert.match(
    migration,
    /PortfolioEvent_userId_fkey.*ON DELETE RESTRICT ON UPDATE CASCADE/,
  );
  assert.match(migration, /CREATE CONSTRAINT TRIGGER/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(cli, /isolationLevel: "Serializable"/);
  assert.match(cli, /pg_advisory_xact_lock/);
  assert.match(cli, /FOR UPDATE/);
  assert.match(cli, /SET CONSTRAINTS/);
  assert.match(cli, /PortfolioEvent_exactly_one_opening_movement_check/);
  assert.match(cli, /AssetMovement_nonnegative_timeline_check/);
  assert.match(cli, /\$5::numeric\(65,30\)/);
  assert.doesNotMatch(cli, /UPDATE "UserAsset"|UPDATE "AssetArchive"/);
  assert.match(preflight, /BEGIN TRANSACTION READ ONLY/);
  assert.match(preflight, /pg_get_constraintdef/);
  assert.match(preflight, /indisexclusion/);
  assert.match(preflight, /datetime_precision/);
  assert.match(verification, /expected_archive_fingerprint/);
  assert.match(verification, /expected_opening_fingerprint/);
  assert.match(verification, /User_ledger_adoption_boundary_guard/);
  assert.match(verification, /AssetMovement_nonnegative_timeline_check/);
  assert.match(verification, /pg_get_constraintdef/);
  assert.match(verification, /source_md5/);
  assert.match(verification, /fires_insert/);
  assert.match(verification, /datetime_precision/);
  assert.match(verification, /tgqual IS NULL/);
  assert.match(verification, /tgnargs/);
  assert.match(verification, /pg_get_triggerdef/);
  assert.equal(verification.match(/WITH legacy AS/g)?.length, 1);
  assert.equal(verification.match(/WITH opening_records AS/g)?.length, 1);
  assert.match(
    verification,
    /set_config\('cryptfolio\.verified_legacy_fingerprint'/,
  );
  assert.match(verification, /set_config\('cryptfolio\.opening_fingerprint'/);
});
