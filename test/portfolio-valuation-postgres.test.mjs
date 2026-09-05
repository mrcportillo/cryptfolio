import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { runOpeningBalanceConversion } from "../scripts/portfolio-ledger/opening-balances-lib.mjs";
import { createPostgresOpeningBalanceStore } from "../scripts/portfolio-ledger/opening-balances.mjs";
import { createPostgresTransactionStore } from "../src/services/portfolio-transactions/postgres.ts";
import { recordTransaction } from "../src/services/portfolio-transactions/service.ts";
import {
  createPostgresSnapshotStore,
  listScheduledDailyTargets,
  listStaleSnapshotTargets,
  listScheduledSnapshotUsers,
} from "../src/services/portfolio-valuation/postgres.ts";
import { runPortfolioSnapshotScheduler } from "../src/services/portfolio-valuation/scheduler.ts";
import {
  adoptionSnapshotTarget,
  capturePortfolioSnapshot,
  dailySnapshotTarget,
} from "../src/services/portfolio-valuation/service.ts";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const configuredUrl = process.env.CRYPTFOLIO_VALUATION_TEST_DATABASE_URL;
const required = process.env.CRYPTFOLIO_REQUIRE_VALUATION_TEST_DATABASE === "1";
const adoptionAt = "2026-08-21T03:00:00.000Z";
const userId = "auth0|valuation-integration";
const positionId = "valuation-integration-bitcoin";

async function runOwnerScheduler(client, source, ownerId, now) {
  const store = createPostgresSnapshotStore(client);
  return runPortfolioSnapshotScheduler(
    {
      listUsers: async () =>
        (await listScheduledSnapshotUsers(client)).filter(
          (user) => user.userId === ownerId,
        ),
      listStaleTargets: (id) => listStaleSnapshotTargets(client, id),
      listDailyTargets: (id, date) =>
        listScheduledDailyTargets(client, id, date),
      capture: (input) => capturePortfolioSnapshot(store, source, input),
    },
    now,
  );
}

export function validateDisposableValuationDatabaseUrl(value) {
  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));

  assert.match(
    url.protocol,
    /^postgres(?:ql)?:$/,
    "valuation test URL must use PostgreSQL",
  );
  assert.ok(
    new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(url.hostname),
    "valuation test URL must use a loopback host",
  );
  assert.match(
    databaseName,
    /cryptfolio.*test/i,
    "valuation test database name must contain both cryptfolio and test",
  );

  return url;
}

function schemaName() {
  return `cryptfolio_valuation_test_${process.pid}_${randomBytes(4).toString("hex")}`;
}

function assertSafeSchema(value) {
  assert.match(value, /^cryptfolio_valuation_test_[a-z0-9_]+$/);
  assert.ok(value.length <= 63);
}

function prismaUrl(baseUrl, schema) {
  const url = new URL(baseUrl);
  url.searchParams.set("options", "-c timezone=UTC");
  url.searchParams.set("schema", schema);
  return url.toString();
}

function command(args, environment) {
  return spawnSync("pnpm", args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

function expectSuccess(result, label) {
  assert.equal(
    result.status,
    0,
    `${label} failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  );
}

async function createAdoptedOwner(
  client,
  {
    ownerId = userId,
    ownerPositionId = positionId,
    ownerEmail = "valuation-integration@example.com",
    ownerAdoptionAt = adoptionAt,
  } = {},
) {
  await client.user.create({
    data: {
      id: ownerId,
      name: "Valuation integration",
      email: ownerEmail,
    },
  });
  await client.userAsset.create({
    data: {
      id: ownerPositionId,
      userId: ownerId,
      assetId: "bitcoin",
      assetName: "Bitcoin",
      amount: 2,
      date: new Date("2026-08-20T12:00:00.000Z"),
    },
  });

  const store = createPostgresOpeningBalanceStore(client);
  const preview = await runOpeningBalanceConversion({ store, userId: ownerId });
  await runOpeningBalanceConversion({
    store,
    userId: ownerId,
    adoptionAt: ownerAdoptionAt,
    expectedFingerprint: preview.legacyFingerprint,
    apply: true,
  });
}

async function ledgerRevision(client) {
  const [owner] = await client.$queryRawUnsafe(
    `SELECT "ledgerRevision" FROM "User" WHERE "id" = $1`,
    userId,
  );
  return owner.ledgerRevision;
}

async function createCompleteBaseline(client) {
  const revision = await ledgerRevision(client);
  await client.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      `INSERT INTO "PortfolioSnapshot" (
         "id", "userId", "kind", "reportingDate"
       ) VALUES ($1, $2, 'ADOPTION_BASELINE', '2026-08-21')`,
      "valuation-baseline",
      userId,
    );
    await transaction.$executeRawUnsafe(
      `INSERT INTO "PortfolioSnapshotRevision" (
         "id", "snapshotId", "userId", "revision", "cutoffAt",
         "ledgerRevision", "provenance", "valuationStatus",
         "reconciliationStatus", "totalValueUsd", "knownValueUsd",
         "actor", "priceRetrievedAt"
       ) VALUES (
         $1, $2, $3, 1, $4, $5, 'ADOPTION_BASELINE', 'COMPLETE',
         'NOT_APPLICABLE', 200, 200, 'valuation-postgres-test', $6
       )`,
      "valuation-baseline-r1",
      "valuation-baseline",
      userId,
      new Date(adoptionAt),
      revision,
      new Date("2026-08-21T03:10:00.000Z"),
    );
    await transaction.$executeRawUnsafe(
      `INSERT INTO "PositionSnapshot" (
         "id", "snapshotRevisionId", "userAssetId", "userId", "assetId",
         "quantity", "priceUsd", "valueUsd", "priceObservedAt", "priceQuality"
       ) VALUES (
         $1, $2, $3, $4, 'bitcoin', 2, 100, 200, $5, 'HISTORICAL_ESTIMATE'
       )`,
      "valuation-baseline-r1-bitcoin",
      "valuation-baseline-r1",
      positionId,
      userId,
      new Date(adoptionAt),
    );
    await transaction.$executeRawUnsafe(
      `UPDATE "PortfolioSnapshot"
       SET "activeRevisionNumber" = 1, "lifecycleStatus" = 'COMPLETE'
       WHERE "id" = $1 AND "userId" = $2`,
      "valuation-baseline",
      userId,
    );
  });
}

async function appendBaselineRevision(client, provenance, reason = null) {
  const revision = await ledgerRevision(client);
  await client.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      `INSERT INTO "PortfolioSnapshotRevision" (
         "id", "snapshotId", "userId", "revision", "cutoffAt",
         "ledgerRevision", "provenance", "valuationStatus",
         "reconciliationStatus", "totalValueUsd", "knownValueUsd", "actor",
         "reason", "priceRetrievedAt"
       ) VALUES (
         $1, $2, $3, 2, $4, $5, $6::"SnapshotRevisionProvenance", 'COMPLETE',
         'NOT_APPLICABLE', 200, 200, 'valuation-postgres-test', $7, $8
       )`,
      `valuation-baseline-r2-${provenance.toLowerCase()}`,
      "valuation-baseline",
      userId,
      new Date(adoptionAt),
      revision,
      provenance,
      reason,
      new Date("2026-08-21T04:00:00.000Z"),
    );
    await transaction.$executeRawUnsafe(
      `INSERT INTO "PositionSnapshot" (
         "id", "snapshotRevisionId", "userAssetId", "userId", "assetId",
         "quantity", "priceUsd", "valueUsd", "priceObservedAt", "priceQuality"
       ) VALUES (
         $1, $2, $3, $4, 'bitcoin', 2, 100, 200, $5, 'HISTORICAL_ESTIMATE'
       )`,
      `valuation-baseline-r2-${provenance.toLowerCase()}-bitcoin`,
      `valuation-baseline-r2-${provenance.toLowerCase()}`,
      positionId,
      userId,
      new Date(adoptionAt),
    );
    await transaction.$executeRawUnsafe(
      `UPDATE "PortfolioSnapshot"
       SET "activeRevisionNumber" = 2, "lifecycleStatus" = 'COMPLETE'
       WHERE "id" = $1 AND "userId" = $2`,
      "valuation-baseline",
      userId,
    );
  });
}

async function createCompletePriceOnlyDaily(client) {
  const revision = await ledgerRevision(client);
  await client.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      `INSERT INTO "PortfolioSnapshot" (
         "id", "userId", "kind", "reportingDate"
       ) VALUES ($1, $2, 'DAILY', '2026-08-21')`,
      "valuation-daily-2026-08-21",
      userId,
    );
    await transaction.$executeRawUnsafe(
      `INSERT INTO "PortfolioSnapshotRevision" (
         "id", "snapshotId", "userId", "revision", "cutoffAt",
         "ledgerRevision", "provenance", "valuationStatus",
         "reconciliationStatus", "totalValueUsd", "knownValueUsd",
         "netExternalFlowUsd", "feesUsd", "priceMovementUsd",
         "eventValuationAdjustmentUsd", "marketMovementUsd", "actor",
         "priceRetrievedAt"
       ) VALUES (
         $1, $2, $3, 1, $4, $5, 'SCHEDULED', 'COMPLETE', 'COMPLETE',
         220, 220, 0, 0, 20, 0, 20, 'valuation-postgres-test', $6
       )`,
      "valuation-daily-2026-08-21-r1",
      "valuation-daily-2026-08-21",
      userId,
      new Date("2026-08-22T03:00:00.000Z"),
      revision,
      new Date("2026-08-22T03:10:00.000Z"),
    );
    await transaction.$executeRawUnsafe(
      `INSERT INTO "PositionSnapshot" (
         "id", "snapshotRevisionId", "userAssetId", "userId", "assetId",
         "quantity", "priceUsd", "valueUsd", "priceObservedAt", "priceQuality"
       ) VALUES (
         $1, $2, $3, $4, 'bitcoin', 2, 110, 220, $5, 'OBSERVED'
       )`,
      "valuation-daily-2026-08-21-r1-bitcoin",
      "valuation-daily-2026-08-21-r1",
      positionId,
      userId,
      new Date("2026-08-22T02:55:00.000Z"),
    );
    await transaction.$executeRawUnsafe(
      `INSERT INTO "CoinSnapshotContribution" (
         "id", "snapshotRevisionId", "userId", "assetId", "externalFlowUsd",
         "feesUsd", "priceMovementUsd", "eventValuationAdjustmentUsd",
         "marketMovementUsd"
       ) VALUES ($1, $2, $3, 'bitcoin', 0, 0, 20, 0, 20)`,
      "valuation-daily-2026-08-21-r1-bitcoin-contribution",
      "valuation-daily-2026-08-21-r1",
      userId,
    );
    await transaction.$executeRawUnsafe(
      `UPDATE "PortfolioSnapshot"
       SET "activeRevisionNumber" = 1, "lifecycleStatus" = 'COMPLETE'
       WHERE "id" = $1 AND "userId" = $2`,
      "valuation-daily-2026-08-21",
      userId,
    );
  });
}

async function createMissingDaily(client) {
  const revision = await ledgerRevision(client);
  await client.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      `INSERT INTO "PortfolioSnapshot" (
         "id", "userId", "kind", "reportingDate"
       ) VALUES ($1, $2, 'DAILY', '2026-08-22')`,
      "valuation-daily-missing",
      userId,
    );
    await transaction.$executeRawUnsafe(
      `INSERT INTO "PortfolioSnapshotRevision" (
         "id", "snapshotId", "userId", "revision", "cutoffAt",
         "ledgerRevision", "provenance", "valuationStatus",
         "reconciliationStatus", "totalValueUsd", "knownValueUsd", "feesUsd",
         "actor", "priceRetrievedAt"
       ) VALUES (
         $1, $2, $3, 1, $4, $5, 'MANUAL', 'INCOMPLETE', 'INCOMPLETE',
         NULL, 0, -5, 'valuation-postgres-test', $6
       )`,
      "valuation-daily-missing-r1",
      "valuation-daily-missing",
      userId,
      new Date("2026-08-23T03:00:00.000Z"),
      revision,
      new Date("2026-08-23T04:00:00.000Z"),
    );
    await transaction.$executeRawUnsafe(
      `INSERT INTO "PositionSnapshot" (
         "id", "snapshotRevisionId", "userAssetId", "userId", "assetId",
         "quantity", "priceUsd", "valueUsd", "priceObservedAt", "priceQuality",
         "missingReason"
       ) VALUES (
         $1, $2, $3, $4, 'bitcoin', 2, NULL, NULL, NULL, 'MISSING',
         'PROVIDER_UNAVAILABLE'
       )`,
      "valuation-daily-missing-r1-bitcoin",
      "valuation-daily-missing-r1",
      positionId,
      userId,
    );
    await transaction.$executeRawUnsafe(
      `UPDATE "PortfolioSnapshot"
       SET "activeRevisionNumber" = 1, "lifecycleStatus" = 'INCOMPLETE'
       WHERE "id" = $1 AND "userId" = $2`,
      "valuation-daily-missing",
      userId,
    );
  });
}

async function repairBackdatedDaily(client) {
  const revision = await ledgerRevision(client);
  await client.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      `INSERT INTO "PortfolioSnapshotRevision" (
         "id", "snapshotId", "userId", "revision", "cutoffAt",
         "ledgerRevision", "provenance", "valuationStatus",
         "reconciliationStatus", "totalValueUsd", "knownValueUsd",
         "netExternalFlowUsd", "feesUsd", "priceMovementUsd",
         "eventValuationAdjustmentUsd", "marketMovementUsd", "actor", "reason",
         "priceRetrievedAt"
       ) VALUES (
         $1, $2, $3, 2, $4, $5, 'REPAIR', 'COMPLETE', 'COMPLETE',
         280, 280, 50, 0, 30, 0, 30, 'valuation-postgres-test',
         'Recalculate backdated transaction effects', $6
       )`,
      "valuation-daily-2026-08-21-r2",
      "valuation-daily-2026-08-21",
      userId,
      new Date("2026-08-22T03:00:00.000Z"),
      revision,
      new Date("2026-08-28T13:00:00.000Z"),
    );
    await transaction.$executeRawUnsafe(
      `INSERT INTO "PositionSnapshot" (
         "id", "snapshotRevisionId", "userAssetId", "userId", "assetId",
         "quantity", "priceUsd", "valueUsd", "priceObservedAt", "priceQuality"
       ) VALUES (
         $1, $2, $3, $4, 'bitcoin', 2.5, 112, 280, $5,
         'HISTORICAL_ESTIMATE'
       )`,
      "valuation-daily-2026-08-21-r2-bitcoin",
      "valuation-daily-2026-08-21-r2",
      positionId,
      userId,
      new Date("2026-08-22T03:00:00.000Z"),
    );
    await transaction.$executeRawUnsafe(
      `INSERT INTO "CoinSnapshotContribution" (
         "id", "snapshotRevisionId", "userId", "assetId", "externalFlowUsd",
         "feesUsd", "priceMovementUsd", "eventValuationAdjustmentUsd",
         "marketMovementUsd"
       ) VALUES ($1, $2, $3, 'bitcoin', 50, 0, 30, 0, 30)`,
      "valuation-daily-2026-08-21-r2-bitcoin-contribution",
      "valuation-daily-2026-08-21-r2",
      userId,
    );
    await transaction.$executeRawUnsafe(
      `UPDATE "PortfolioSnapshot"
       SET "activeRevisionNumber" = 2,
           "lifecycleStatus" = 'COMPLETE',
           "staleAt" = NULL
       WHERE "id" = $1 AND "userId" = $2`,
      "valuation-daily-2026-08-21",
      userId,
    );
  });
}

test("valuation database guard rejects non-PostgreSQL, remote, and broad targets", () => {
  assert.throws(
    () =>
      validateDisposableValuationDatabaseUrl(
        "mysql://localhost/cryptfolio_test",
      ),
    /must use PostgreSQL/,
  );
  assert.throws(
    () =>
      validateDisposableValuationDatabaseUrl(
        "postgresql://database.example.com/cryptfolio_test",
      ),
    /loopback host/,
  );
  assert.throws(
    () =>
      validateDisposableValuationDatabaseUrl(
        "postgresql://localhost/cryptfolio",
      ),
    /both cryptfolio and test/,
  );
  assert.equal(
    validateDisposableValuationDatabaseUrl(
      "postgresql://localhost/cryptfolio_valuation_test",
    ).hostname,
    "localhost",
  );
});

if (!configuredUrl) {
  test(
    "portfolio valuation PostgreSQL integration requires an explicit disposable URL",
    { skip: !required },
    () => {
      assert.fail(
        "Set CRYPTFOLIO_VALUATION_TEST_DATABASE_URL to a loopback PostgreSQL database whose name contains cryptfolio and test.",
      );
    },
  );
} else {
  test("portfolio valuation invariants hold in disposable PostgreSQL", async (t) => {
    const baseUrl = validateDisposableValuationDatabaseUrl(configuredUrl);
    const schema = schemaName();
    assertSafeSchema(schema);
    const adminUrl = prismaUrl(baseUrl, "public");
    const databaseUrl = prismaUrl(baseUrl, schema);
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    let client;

    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);

      await t.test("all migrations deploy without Prisma drift", () => {
        const environment = {
          POSTGRES_PRISMA_URL: databaseUrl,
          POSTGRES_URL_NON_POOLING: databaseUrl,
        };
        expectSuccess(
          command(["prisma", "migrate", "deploy"], environment),
          "migration deploy",
        );
        const diff = command(
          [
            "prisma",
            "migrate",
            "diff",
            "--from-url",
            databaseUrl,
            "--to-schema-datamodel",
            "prisma/schema.prisma",
            "--script",
            "--exit-code",
          ],
          environment,
        );
        expectSuccess(diff, "migration diff");
        assert.match(diff.stdout, /empty migration/i);
      });

      client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      await createAdoptedOwner(client);

      await t.test(
        "the PostgreSQL store publishes concurrent captures idempotently",
        async () => {
          const serviceUserId = "auth0|valuation-service";
          const servicePositionId = "valuation-service-bitcoin";
          const serviceAdoptionAt = new Date("2026-08-25T15:00:00.000Z");
          await createAdoptedOwner(client, {
            ownerId: serviceUserId,
            ownerPositionId: servicePositionId,
            ownerEmail: "valuation-service@example.com",
            ownerAdoptionAt: serviceAdoptionAt.toISOString(),
          });
          const store = createPostgresSnapshotStore(client);
          const priceSource = {
            async resolve(_assetId, requestedAt) {
              return {
                observation: {
                  observedAt: new Date(requestedAt.getTime() - 60_000),
                  priceUsd: "100",
                },
              };
            },
          };
          const input = {
            userId: serviceUserId,
            target: adoptionSnapshotTarget(serviceAdoptionAt),
            provenance: "ADOPTION_BASELINE",
            actor: "valuation-postgres-test",
            apply: true,
            now: new Date("2026-08-26T04:00:00.000Z"),
          };
          const captures = await Promise.all([
            capturePortfolioSnapshot(store, priceSource, input),
            capturePortfolioSnapshot(store, priceSource, input),
          ]);
          assert.equal(
            captures.filter((capture) => capture.published.created).length,
            1,
          );
          const baseline = await client.portfolioSnapshot.findUnique({
            where: {
              userId_kind_reportingDate: {
                userId: serviceUserId,
                kind: "ADOPTION_BASELINE",
                reportingDate: new Date("2026-08-25T00:00:00.000Z"),
              },
            },
            include: { revisions: true },
          });
          assert.equal(baseline.revisions.length, 1);
          assert.equal(baseline.lifecycleStatus, "COMPLETE");

          const daily = await capturePortfolioSnapshot(
            store,
            {
              async resolve(_assetId, requestedAt) {
                return {
                  observation: {
                    observedAt: new Date(requestedAt.getTime() - 60_000),
                    priceUsd: "110",
                  },
                };
              },
            },
            {
              userId: serviceUserId,
              target: dailySnapshotTarget("2026-08-25"),
              provenance: "MANUAL",
              actor: "valuation-postgres-test",
              apply: true,
              now: new Date("2026-08-26T04:00:00.000Z"),
            },
          );
          assert.equal(daily.draft.totalValueUsd, "220");
          assert.equal(daily.draft.marketMovementUsd, "20");
          assert.equal(daily.published.created, true);

          await recordTransaction(
            createPostgresTransactionStore(client),
            serviceUserId,
            {
              kind: "BUY",
              occurredAt: "2026-08-26T15:00:00.000Z",
              idempotencyKey: randomUUID(),
              actualValueUsd: "120",
              position: { userAssetId: servicePositionId, quantity: "1" },
            },
            new Date("2026-08-27T04:00:00.000Z"),
          );
          const withFlow = await capturePortfolioSnapshot(
            store,
            {
              async resolve(_assetId, requestedAt) {
                return {
                  observation: {
                    observedAt: new Date(requestedAt.getTime() - 60_000),
                    priceUsd:
                      requestedAt.toISOString() === "2026-08-26T15:00:00.000Z"
                        ? "120"
                        : "130",
                  },
                };
              },
            },
            {
              userId: serviceUserId,
              target: dailySnapshotTarget("2026-08-26"),
              provenance: "MANUAL",
              actor: "valuation-postgres-test",
              apply: true,
              now: new Date("2026-08-27T04:00:00.000Z"),
            },
          );
          assert.equal(withFlow.draft.totalValueUsd, "390");
          assert.equal(withFlow.draft.netExternalFlowUsd, "120");
          assert.equal(withFlow.draft.priceMovementUsd, "50");
          assert.equal(withFlow.draft.marketMovementUsd, "50");
          assert.equal(withFlow.draft.reconciliationStatus, "COMPLETE");

          // A later ledger write must not revise an unaffected completed day.
          const repeated = await capturePortfolioSnapshot(
            store,
            priceSource,
            input,
          );
          assert.equal(repeated.published.created, false);
          assert.equal(repeated.published.revision, 1);

          // Repairing prices without a ledger change invalidates later periods.
          await capturePortfolioSnapshot(store, priceSource, {
            ...input,
            provenance: "REPAIR",
            reason: "Verify historical price repair",
          });
          const stale = await listStaleSnapshotTargets(client, serviceUserId);
          assert.deepEqual(
            stale.map((target) => target.reportingDate),
            ["2026-08-25", "2026-08-26"],
          );
          await runOwnerScheduler(
            client,
            priceSource,
            serviceUserId,
            new Date("2026-08-27T04:00:00.000Z"),
          );
          assert.equal(
            (await listStaleSnapshotTargets(client, serviceUserId)).length,
            0,
          );
        },
      );

      await t.test(
        "scheduler retries an incomplete baseline and fills gaps before the newest snapshot",
        async () => {
          const ownerId = "auth0|valuation-gaps";
          const adoptedAt = new Date("2026-08-24T12:00:00.000Z");
          await createAdoptedOwner(client, {
            ownerId,
            ownerPositionId: "valuation-gaps-btc",
            ownerEmail: "gaps@example.com",
            ownerAdoptionAt: adoptedAt.toISOString(),
          });
          const store = createPostgresSnapshotStore(client);
          const input = {
            userId: ownerId,
            target: adoptionSnapshotTarget(adoptedAt),
            provenance: "ADOPTION_BASELINE",
            actor: "test",
            apply: true,
            now: new Date("2026-08-28T04:00:00Z"),
          };
          const missing = {
            async resolve() {
              return {
                observation: null,
                missingReason: "PROVIDER_UNAVAILABLE",
              };
            },
          };
          await capturePortfolioSnapshot(store, missing, input);
          await capturePortfolioSnapshot(store, missing, {
            ...input,
            target: dailySnapshotTarget("2026-08-27"),
            provenance: "MANUAL",
          });
          assert.deepEqual(
            (
              await listScheduledDailyTargets(client, ownerId, "2026-08-27")
            ).map((target) => target.reportingDate),
            ["2026-08-24", "2026-08-25", "2026-08-26"],
          );
          const source = {
            async resolve(_assetId, at) {
              return { observation: { observedAt: at, priceUsd: "100" } };
            },
          };
          await runOwnerScheduler(client, source, ownerId, input.now);
          const snapshots = await client.portfolioSnapshot.findMany({
            where: { userId: ownerId },
            include: { activeRevision: true },
          });
          assert.equal(snapshots.length, 5);
          assert.ok(
            snapshots.every(
              (snapshot) => snapshot.lifecycleStatus === "COMPLETE",
            ),
          );
          assert.equal(
            snapshots.find((snapshot) => snapshot.kind === "ADOPTION_BASELINE")
              .activeRevision.provenance,
            "REPAIR",
          );
        },
      );

      await t.test(
        "Salta cutoffs and price-only daily movement are stable",
        async () => {
          const [boundary] = await client.$queryRawUnsafe(
            `SELECT "snapshot_daily_cutoff_utc"('2026-08-21') AS cutoff`,
          );
          assert.equal(
            boundary.cutoff.toISOString(),
            "2026-08-22T03:00:00.000Z",
          );

          await createCompleteBaseline(client);
          await assert.rejects(
            appendBaselineRevision(client, "ADOPTION_BASELINE"),
            /explicit repair provenance|adoption_baseline_boundary_check/i,
          );
          await appendBaselineRevision(
            client,
            "REPAIR",
            "Provider recovery for adoption baseline",
          );
          await createCompletePriceOnlyDaily(client);
          const [daily] = await client.$queryRawUnsafe(
            `SELECT revision."totalValueUsd"::text AS total,
                  revision."marketMovementUsd"::text AS movement
           FROM "PortfolioSnapshot" header
           JOIN "PortfolioSnapshotRevision" revision
             ON revision."snapshotId" = header."id"
            AND revision."revision" = header."activeRevisionNumber"
           WHERE header."id" = $1`,
            "valuation-daily-2026-08-21",
          );
          assert.equal(daily.total, "220.000000000000000000000000000000");
          assert.equal(daily.movement, "20.000000000000000000000000000000");
        },
      );

      await t.test(
        "a logical day remains unique under concurrent retries",
        async () => {
          const second = new PrismaClient({
            datasources: { db: { url: databaseUrl } },
          });
          try {
            const insert = (connection, id) =>
              connection.$executeRawUnsafe(
                `INSERT INTO "PortfolioSnapshot" (
                 "id", "userId", "kind", "reportingDate"
               ) VALUES ($1, $2, 'DAILY', '2026-08-24')
               ON CONFLICT ("userId", "kind", "reportingDate") DO NOTHING`,
                id,
                userId,
              );
            const counts = await Promise.all([
              insert(client, "valuation-idempotency-a"),
              insert(second, "valuation-idempotency-b"),
            ]);
            assert.deepEqual([...counts].sort(), [0, 1]);
            const [result] = await client.$queryRawUnsafe(
              `SELECT count(*)::integer AS count
             FROM "PortfolioSnapshot"
             WHERE "userId" = $1
               AND "kind" = 'DAILY'
               AND "reportingDate" = '2026-08-24'`,
              userId,
            );
            assert.equal(result.count, 1);
          } finally {
            await second.$disconnect();
          }
        },
      );

      await t.test(
        "partial revisions cannot commit and evidence is immutable",
        async () => {
          await client.$executeRawUnsafe(
            `INSERT INTO "PortfolioSnapshot" (
             "id", "userId", "kind", "reportingDate"
           ) VALUES ($1, $2, 'DAILY', '2026-08-25')`,
            "valuation-unactivated",
            userId,
          );
          const revision = await ledgerRevision(client);
          await assert.rejects(
            client.$executeRawUnsafe(
              `INSERT INTO "PortfolioSnapshotRevision" (
               "id", "snapshotId", "userId", "revision", "cutoffAt",
               "ledgerRevision", "provenance", "valuationStatus",
               "reconciliationStatus", "knownValueUsd", "actor",
               "priceRetrievedAt"
             ) VALUES (
               $1, $2, $3, 1, $4, $5, 'MANUAL', 'INCOMPLETE', 'INCOMPLETE',
               0, 'valuation-postgres-test', $6
             )`,
              "valuation-unactivated-r1",
              "valuation-unactivated",
              userId,
              new Date("2026-08-26T03:00:00.000Z"),
              revision,
              new Date("2026-08-26T04:00:00.000Z"),
            ),
            /must be activated in the same transaction|activation_check/i,
          );
          await assert.rejects(
            client.$executeRawUnsafe(
              `UPDATE "PortfolioSnapshotRevision"
             SET "actor" = 'tampered'
             WHERE "id" = $1`,
              "valuation-baseline-r1",
            ),
            /immutable/i,
          );
          await assert.rejects(
            client.$executeRawUnsafe(
              `DELETE FROM "PositionSnapshot" WHERE "id" = $1`,
              "valuation-baseline-r1-bitcoin",
            ),
            /immutable/i,
          );
        },
      );

      await t.test(
        "missing prices stay NULL and signed repair fields remain valid",
        async () => {
          await createMissingDaily(client);
          const [line] = await client.$queryRawUnsafe(
            `SELECT "priceUsd", "valueUsd", "missingReason"::text AS reason
           FROM "PositionSnapshot"
           WHERE "id" = $1`,
            "valuation-daily-missing-r1-bitcoin",
          );
          assert.equal(line.priceUsd, null);
          assert.equal(line.valueUsd, null);
          assert.equal(line.reason, "PROVIDER_UNAVAILABLE");

          const [revision] = await client.$queryRawUnsafe(
            `SELECT "totalValueUsd", "knownValueUsd"::text AS known,
                  "feesUsd"::text AS fees
           FROM "PortfolioSnapshotRevision"
           WHERE "id" = $1`,
            "valuation-daily-missing-r1",
          );
          assert.equal(revision.totalValueUsd, null);
          assert.equal(revision.known, "0.000000000000000000000000000000");
          assert.equal(revision.fees, "-5.000000000000000000000000000000");
        },
      );

      await t.test(
        "position evidence requires positive prices and owner-safe references",
        async () => {
          await client.user.create({
            data: {
              id: "auth0|valuation-other-owner",
              name: "Other valuation owner",
              email: "valuation-other-owner@example.com",
            },
          });
          await client.userAsset.create({
            data: {
              id: "valuation-other-owner-bitcoin",
              userId: "auth0|valuation-other-owner",
              assetId: "bitcoin",
              assetName: "Other Bitcoin",
              amount: 0,
            },
          });

          const insertInvalidLine = (lineSql, ...lineParameters) =>
            client.$transaction(async (transaction) => {
              const revision = await ledgerRevision(transaction);
              await transaction.$executeRawUnsafe(
                `INSERT INTO "PortfolioSnapshot" (
                   "id", "userId", "kind", "reportingDate"
                 ) VALUES ($1, $2, 'DAILY', '2026-08-27')`,
                "valuation-invalid-line",
                userId,
              );
              await transaction.$executeRawUnsafe(
                `INSERT INTO "PortfolioSnapshotRevision" (
                   "id", "snapshotId", "userId", "revision", "cutoffAt",
                   "ledgerRevision", "provenance", "valuationStatus",
                   "reconciliationStatus", "knownValueUsd", "actor",
                   "priceRetrievedAt"
                 ) VALUES (
                   $1, $2, $3, 1, $4, $5, 'MANUAL', 'INCOMPLETE', 'INCOMPLETE',
                   0, 'valuation-postgres-test', $6
                 )`,
                "valuation-invalid-line-r1",
                "valuation-invalid-line",
                userId,
                new Date("2026-08-28T03:00:00.000Z"),
                revision,
                new Date("2026-08-28T04:00:00.000Z"),
              );
              await transaction.$executeRawUnsafe(lineSql, ...lineParameters);
            });

          await assert.rejects(
            insertInvalidLine(
              `INSERT INTO "PositionSnapshot" (
                 "id", "snapshotRevisionId", "userAssetId", "userId", "assetId",
                 "quantity", "priceUsd", "valueUsd", "priceObservedAt", "priceQuality"
               ) VALUES ($1, $2, $3, $4, 'bitcoin', 2, 0, 0, $5, 'HISTORICAL_ESTIMATE')`,
              "valuation-zero-price",
              "valuation-invalid-line-r1",
              positionId,
              userId,
              new Date("2026-08-28T03:00:00.000Z"),
            ),
            /PositionSnapshot_nonnegative_values_check|check constraint/i,
          );

          await assert.rejects(
            insertInvalidLine(
              `INSERT INTO "PositionSnapshot" (
                 "id", "snapshotRevisionId", "userAssetId", "userId", "assetId",
                 "quantity", "priceQuality", "missingReason"
               ) VALUES ($1, $2, $3, $4, 'bitcoin', 2, 'MISSING',
                         'PROVIDER_UNAVAILABLE')`,
              "valuation-cross-owner",
              "valuation-invalid-line-r1",
              "valuation-other-owner-bitcoin",
              userId,
            ),
            /PositionSnapshot_userAssetId_userId_fkey|foreign key/i,
          );
        },
      );

      await t.test(
        "backdated movements stale affected days and coalesce repair work",
        async () => {
          const store = createPostgresTransactionStore(client);
          await recordTransaction(
            store,
            userId,
            {
              kind: "BUY",
              occurredAt: "2026-08-21T12:00:00.000Z",
              idempotencyKey: randomUUID(),
              actualValueUsd: "110",
              position: { userAssetId: positionId, quantity: "1" },
            },
            new Date("2026-08-28T12:00:00.000Z"),
          );
          await recordTransaction(
            store,
            userId,
            {
              kind: "SELL",
              occurredAt: "2026-08-21T18:00:00.000Z",
              idempotencyKey: randomUUID(),
              actualValueUsd: "60",
              position: { userAssetId: positionId, quantity: "0.5" },
            },
            new Date("2026-08-28T12:00:00.000Z"),
          );

          const snapshots = await client.$queryRawUnsafe(
            `SELECT "id", "lifecycleStatus"::text AS status
           FROM "PortfolioSnapshot"
           WHERE "id" IN ('valuation-baseline', 'valuation-daily-2026-08-21')
           ORDER BY "id"`,
          );
          assert.deepEqual(snapshots, [
            { id: "valuation-baseline", status: "COMPLETE" },
            { id: "valuation-daily-2026-08-21", status: "STALE" },
          ]);

          const [queue] = await client.$queryRawUnsafe(
            `SELECT "earliestAffectedAt", "ledgerRevision"
           FROM "SnapshotRecalculationRequest"
           WHERE "userId" = $1`,
            userId,
          );
          assert.equal(
            queue.earliestAffectedAt.toISOString(),
            "2026-08-21T12:00:00.000Z",
          );
          assert.equal(queue.ledgerRevision, 3n);

          await repairBackdatedDaily(client);
          const [repaired] = await client.$queryRawUnsafe(
            `SELECT "activeRevisionNumber" AS revision,
                    "lifecycleStatus"::text AS status,
                    "staleAt"
             FROM "PortfolioSnapshot"
             WHERE "id" = $1`,
            "valuation-daily-2026-08-21",
          );
          assert.deepEqual(repaired, {
            revision: 2,
            status: "COMPLETE",
            staleAt: null,
          });
        },
      );

      await t.test("activation rejects a stale ledger capture", async () => {
        await assert.rejects(
          client.$transaction(async (transaction) => {
            await transaction.$executeRawUnsafe(
              `INSERT INTO "PortfolioSnapshot" (
                 "id", "userId", "kind", "reportingDate"
               ) VALUES ($1, $2, 'DAILY', '2026-08-26')`,
              "valuation-stale-capture",
              userId,
            );
            await transaction.$executeRawUnsafe(
              `INSERT INTO "PortfolioSnapshotRevision" (
                 "id", "snapshotId", "userId", "revision", "cutoffAt",
                 "ledgerRevision", "provenance", "valuationStatus",
                 "reconciliationStatus", "knownValueUsd", "actor",
                 "priceRetrievedAt"
               ) VALUES (
                 $1, $2, $3, 1, $4, 2, 'MANUAL', 'INCOMPLETE', 'INCOMPLETE',
                 0, 'valuation-postgres-test', $5
               )`,
              "valuation-stale-capture-r1",
              "valuation-stale-capture",
              userId,
              new Date("2026-08-27T03:00:00.000Z"),
              new Date("2026-08-27T04:00:00.000Z"),
            );
            await transaction.$executeRawUnsafe(
              `INSERT INTO "PositionSnapshot" (
                 "id", "snapshotRevisionId", "userAssetId", "userId", "assetId",
                 "quantity", "priceQuality", "missingReason"
               ) VALUES (
                 $1, $2, $3, $4, 'bitcoin', 2.5, 'MISSING',
                 'PROVIDER_UNAVAILABLE'
               )`,
              "valuation-stale-capture-r1-bitcoin",
              "valuation-stale-capture-r1",
              positionId,
              userId,
            );
            await transaction.$executeRawUnsafe(
              `UPDATE "PortfolioSnapshot"
               SET "activeRevisionNumber" = 1, "lifecycleStatus" = 'INCOMPLETE'
               WHERE "id" = $1 AND "userId" = $2`,
              "valuation-stale-capture",
              userId,
            );
          }),
          /raced with a ledger movement|ledger_revision_check/i,
        );
      });
    } finally {
      if (client) await client.$disconnect();
      await admin.$executeRawUnsafe(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
      );
      await admin.$disconnect();
    }
  });
}
