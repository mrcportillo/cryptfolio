import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { runOpeningBalanceConversion } from "../scripts/portfolio-ledger/opening-balances-lib.mjs";
import { createPostgresOpeningBalanceStore } from "../scripts/portfolio-ledger/opening-balances.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const configuredUrl = process.env.CRYPTFOLIO_LEDGER_TEST_DATABASE_URL;
const testIsRequired =
  process.env.CRYPTFOLIO_REQUIRE_LEDGER_TEST_DATABASE === "1";
const adoptionAt = "2026-08-21T03:00:00.000Z";
const emptySha256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function validateDisposableDatabaseUrl(value) {
  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

  assert.match(
    url.protocol,
    /^postgres(?:ql)?:$/,
    "test URL must use PostgreSQL",
  );
  assert.ok(
    loopbackHosts.has(url.hostname),
    "test URL must use a loopback host",
  );
  assert.match(
    databaseName,
    /cryptfolio.*test/i,
    "test database name must contain both cryptfolio and test",
  );

  return url;
}

function schemaName(suffix) {
  return `cryptfolio_ledger_test_${process.pid}_${suffix}_${randomBytes(4).toString("hex")}`;
}

function assertSafeSchema(value) {
  assert.match(value, /^cryptfolio_ledger_test_[a-z0-9_]+$/);
  assert.ok(value.length <= 63);
}

function prismaUrl(baseUrl, schema) {
  const url = new URL(baseUrl);
  url.searchParams.delete("options");
  url.searchParams.set("schema", schema);
  return url.toString();
}

function psqlUrl(baseUrl, schema) {
  const url = new URL(baseUrl);
  url.searchParams.delete("schema");
  url.searchParams.set("options", `-csearch_path=${schema}`);
  return url.toString();
}

function command(commandName, args, environment = {}) {
  return spawnSync(commandName, args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

function commandAsync(commandName, args, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, {
      cwd: projectRoot,
      env: { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function expectSuccess(result, label) {
  assert.equal(
    result.status,
    0,
    `${label} failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  );
}

function psqlFile(databaseUrl, file, variables = {}) {
  const args = [databaseUrl, "-v", "ON_ERROR_STOP=1"];
  for (const [key, value] of Object.entries(variables)) {
    args.push("-v", `${key}=${value}`);
  }
  args.push("-f", path.join(projectRoot, file));
  return command("psql", args);
}

function psqlCommand(databaseUrl, sql) {
  return command("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

function cli(databaseUrl, args) {
  return command(
    process.execPath,
    [
      path.join(projectRoot, "scripts/portfolio-ledger/opening-balances.mjs"),
      ...args,
    ],
    { POSTGRES_URL_NON_POOLING: databaseUrl },
  );
}

function cliAsync(databaseUrl, args) {
  return commandAsync(
    process.execPath,
    [
      path.join(projectRoot, "scripts/portfolio-ledger/opening-balances.mjs"),
      ...args,
    ],
    { POSTGRES_URL_NON_POOLING: databaseUrl },
  );
}

function parseCli(result, label) {
  expectSuccess(result, label);
  return JSON.parse(result.stdout);
}

if (!configuredUrl) {
  test(
    "opening ledger PostgreSQL integration requires an explicit disposable URL",
    { skip: !testIsRequired },
    () => {
      assert.fail(
        "Set CRYPTFOLIO_LEDGER_TEST_DATABASE_URL to a loopback PostgreSQL database whose name contains cryptfolio and test.",
      );
    },
  );
} else {
  test("opening ledger works against a disposable PostgreSQL schema", async (t) => {
    const baseUrl = validateDisposableDatabaseUrl(configuredUrl);
    const ledgerSchema = schemaName("ledger");
    const baselineSchema = schemaName("baseline");
    assertSafeSchema(ledgerSchema);
    assertSafeSchema(baselineSchema);

    const adminUrl = prismaUrl(baseUrl, "public");
    const ledgerPrismaUrl = prismaUrl(baseUrl, ledgerSchema);
    const ledgerPsqlUrl = psqlUrl(baseUrl, ledgerSchema);
    const baselinePsqlUrl = psqlUrl(baseUrl, baselineSchema);
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    let client;

    try {
      for (const schema of [ledgerSchema, baselineSchema]) {
        await admin.$executeRawUnsafe(
          `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
        );
        await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      }

      await t.test("migrations deploy and match the Prisma schema", () => {
        const deploy = command("pnpm", ["prisma", "migrate", "deploy"], {
          POSTGRES_PRISMA_URL: ledgerPrismaUrl,
          POSTGRES_URL_NON_POOLING: ledgerPrismaUrl,
        });
        expectSuccess(deploy, "prisma migrate deploy");

        const diff = command(
          "pnpm",
          [
            "prisma",
            "migrate",
            "diff",
            "--from-url",
            ledgerPrismaUrl,
            "--to-schema-datamodel",
            "prisma/schema.prisma",
            "--script",
            "--exit-code",
          ],
          {
            POSTGRES_PRISMA_URL: ledgerPrismaUrl,
            POSTGRES_URL_NON_POOLING: ledgerPrismaUrl,
          },
        );
        expectSuccess(diff, "prisma migrate diff");
        assert.match(diff.stdout, /empty migration/i);
      });

      client = new PrismaClient({
        datasources: { db: { url: ledgerPrismaUrl } },
      });

      await client.user.create({
        data: {
          id: "auth0|integration",
          name: "Integration",
          email: "integration@example.com",
        },
      });
      await client.userAsset.createMany({
        data: [
          {
            id: "integration-zero",
            userId: "auth0|integration",
            assetId: "usd-coin",
            assetName: "Integration zero",
            amount: 0,
            date: new Date("2026-08-20T12:01:00.000Z"),
          },
          {
            id: "integration-missing",
            userId: "auth0|integration",
            assetId: "missing-opening-fixture",
            assetName: "Missing opening fixture",
            amount: 0,
            date: new Date("2026-08-20T12:02:00.000Z"),
          },
          {
            id: "integration-duplicate",
            userId: "auth0|integration",
            assetId: "duplicate-opening-fixture",
            assetName: "Duplicate opening fixture",
            amount: 0,
            date: new Date("2026-08-20T12:03:00.000Z"),
          },
          {
            id: "integration-wrong-opening",
            userId: "auth0|integration",
            assetId: "wrong-opening-fixture",
            assetName: "Wrong opening fixture",
            amount: 0,
            date: new Date("2026-08-20T12:04:00.000Z"),
          },
          {
            id: "integration-wrong-target",
            userId: "auth0|integration",
            assetId: "wrong-target-fixture",
            assetName: "Wrong target fixture",
            amount: 0,
            date: new Date("2026-08-20T12:05:00.000Z"),
          },
        ],
      });
      await client.$executeRawUnsafe(
        `INSERT INTO "UserAsset" (
          "id", "userId", "assetId", "assetName", "amount", "date"
        ) VALUES (
          'integration-btc', 'auth0|integration', 'bitcoin', 'Integration BTC',
          0.12345678901234567::double precision, '2026-08-20 12:00:00'
        )`,
      );

      let dryRun;
      let applied;
      await t.test(
        "real CLI apply locks, converts, and retries idempotently",
        async () => {
          dryRun = parseCli(
            cli(ledgerPrismaUrl, [
              "--user-id",
              "auth0|integration",
              "--adoption-at",
              adoptionAt,
            ]),
            "opening dry run",
          );
          applied = parseCli(
            cli(ledgerPrismaUrl, [
              "--user-id",
              "auth0|integration",
              "--apply",
              "--adoption-at",
              adoptionAt,
              "--expected-fingerprint",
              dryRun.legacyFingerprint,
            ]),
            "opening apply",
          );
          const retry = parseCli(
            cli(ledgerPrismaUrl, [
              "--user-id",
              "auth0|integration",
              "--apply",
              "--adoption-at",
              adoptionAt,
              "--expected-fingerprint",
              dryRun.legacyFingerprint,
            ]),
            "opening retry",
          );

          assert.equal(applied.alreadyApplied, false);
          assert.equal(retry.alreadyApplied, true);
          assert.equal(retry.openingFingerprint, applied.openingFingerprint);
          const openings = await client.portfolioEvent.findMany({
            where: { userId: "auth0|integration", kind: "OPENING_BALANCE" },
            include: { movements: true },
          });
          assert.equal(openings.length, 1);
          assert.equal(openings[0].movements.length, 1);
          const [source] = await client.$queryRawUnsafe(
            `SELECT "amount"::text AS "amountText"
           FROM "UserAsset"
           WHERE "id" = 'integration-btc'`,
          );
          assert.equal(
            openings[0].movements[0].quantityDelta.toString(),
            source.amountText,
          );
          assert.equal(openings[0].externalFlowUsd.toString(), "0");
          assert.equal(openings[0].feeUsd.toString(), "0");
        },
      );

      await t.test(
        "concurrent applies serialize on the per-user advisory lock",
        async () => {
          await client.user.create({
            data: {
              id: "auth0|concurrent",
              name: "Concurrent",
              email: "concurrent@example.com",
            },
          });
          await client.userAsset.create({
            data: {
              id: "concurrent-btc",
              userId: "auth0|concurrent",
              assetId: "bitcoin",
              assetName: "Concurrent BTC",
              amount: 1,
              date: new Date("2026-08-20T12:00:00Z"),
            },
          });
          const preview = parseCli(
            cli(ledgerPrismaUrl, ["--user-id", "auth0|concurrent"]),
            "concurrent opening dry run",
          );
          const args = [
            "--user-id",
            "auth0|concurrent",
            "--apply",
            "--adoption-at",
            adoptionAt,
            "--expected-fingerprint",
            preview.legacyFingerprint,
          ];
          const results = await Promise.all([
            cliAsync(ledgerPrismaUrl, args),
            cliAsync(ledgerPrismaUrl, args),
          ]);
          const conversions = results.map((result, index) =>
            parseCli(result, `concurrent opening apply ${index + 1}`),
          );

          assert.deepEqual(
            conversions.map(({ alreadyApplied }) => alreadyApplied).sort(),
            [false, true],
          );
          assert.equal(
            await client.portfolioEvent.count({
              where: { userId: "auth0|concurrent", kind: "OPENING_BALANCE" },
            }),
            1,
          );
        },
      );

      await t.test(
        "unknown money stays null and adopted-user deletion is restricted",
        async () => {
          const unknownMoney = await client.portfolioEvent.create({
            data: {
              id: "event-unknown-money",
              userId: "auth0|integration",
              kind: "BUY",
              occurredAt: new Date("2026-08-21T04:00:00.000Z"),
              feeUsd: "0",
              idempotencyKey: "integration:unknown-money",
              movements: {
                create: {
                  id: "movement-unknown-money",
                  userAssetId: "integration-btc",
                  role: "PRINCIPAL",
                  quantityDelta: "0.01",
                },
              },
            },
          });
          assert.equal(unknownMoney.externalFlowUsd, null);
          assert.equal(unknownMoney.actualValueUsd, null);
          assert.equal(unknownMoney.feeUsd.toString(), "0");
          await assert.rejects(
            client.user.delete({ where: { id: "auth0|integration" } }),
            /foreign key constraint/i,
          );
        },
      );

      await t.test(
        "owner-safe keys and reversal checks reject invalid ledger links",
        async () => {
          await client.user.create({
            data: {
              id: "auth0|other",
              name: "Other owner",
              email: "other-owner@example.com",
            },
          });
          await client.userAsset.create({
            data: {
              id: "other-btc",
              userId: "auth0|other",
              assetId: "bitcoin",
              assetName: "Other BTC",
              amount: 0,
              date: new Date("2026-08-20T12:00:00Z"),
            },
          });
          await client.user.update({
            where: { id: "auth0|other" },
            data: { ledgerAdoptedAt: new Date(adoptionAt) },
          });
          await client.portfolioEvent.create({
            data: {
              id: "other-event",
              userId: "auth0|other",
              kind: "BUY",
              occurredAt: new Date("2026-08-21T04:05:00.000Z"),
              feeUsd: "0",
              idempotencyKey: "other:event",
              movements: {
                create: {
                  id: "other-movement",
                  userAssetId: "other-btc",
                  role: "PRINCIPAL",
                  quantityDelta: "1",
                },
              },
            },
          });

          await assert.rejects(
            client.$executeRawUnsafe(
              `INSERT INTO "AssetMovement" (
              "id", "userId", "portfolioEventId", "userAssetId", "quantityDelta"
             ) VALUES (
              'cross-owner-movement', 'auth0|integration',
              'event-unknown-money', 'other-btc', 1
             )`,
            ),
            /foreign key constraint/i,
          );
          await assert.rejects(
            client.$executeRawUnsafe(
              `INSERT INTO "PortfolioEvent" (
              "id", "userId", "kind", "occurredAt", "externalFlowUsd", "feeUsd",
              "idempotencyKey", "openingForUserAssetId"
             ) VALUES (
              'cross-owner-opening', 'auth0|integration', 'OPENING_BALANCE',
              '2026-08-21 04:10:00', 0, 0, 'integration:cross-owner-opening',
              'other-btc'
             )`,
            ),
            /foreign key constraint/i,
          );
          await assert.rejects(
            client.$executeRawUnsafe(
              `INSERT INTO "PortfolioEvent" (
              "id", "userId", "kind", "occurredAt", "idempotencyKey",
              "reversalOfEventId"
             ) VALUES (
              'cross-owner-reversal', 'auth0|integration', 'REVERSAL',
              '2026-08-21 04:15:00', 'integration:cross-owner-reversal',
              'other-event'
             )`,
            ),
            /foreign key constraint/i,
          );
          await assert.rejects(
            client.$executeRawUnsafe(
              `INSERT INTO "PortfolioEvent" (
              "id", "userId", "kind", "occurredAt", "feeUsd", "idempotencyKey"
             ) VALUES (
              'negative-normal-fee', 'auth0|integration', 'BUY',
              '2026-08-21 04:20:00', -1, 'integration:negative-normal-fee'
             )`,
            ),
            /PortfolioEvent_fee_sign_check/i,
          );
          await assert.rejects(
            client.$executeRawUnsafe(
              `INSERT INTO "PortfolioEvent" (
              "id", "userId", "kind", "occurredAt", "idempotencyKey"
             ) VALUES (
              'unlinked-reversal', 'auth0|integration', 'REVERSAL',
              '2026-08-21 04:25:00', 'integration:unlinked-reversal'
             )`,
            ),
            /PortfolioEvent_reversal_shape_check/i,
          );
          await assert.rejects(
            client.$executeRawUnsafe(
              `INSERT INTO "PortfolioEvent" (
              "id", "userId", "kind", "occurredAt", "idempotencyKey",
              "reversalOfEventId"
             ) VALUES (
              'self-reversal', 'auth0|integration', 'REVERSAL',
              '2026-08-21 04:30:00', 'integration:self-reversal',
              'self-reversal'
             )`,
            ),
            /PortfolioEvent_not_self_reversal_check/i,
          );

          const reversal = await client.portfolioEvent.create({
            data: {
              id: "valid-reversal",
              userId: "auth0|integration",
              kind: "REVERSAL",
              occurredAt: new Date("2026-08-21T04:00:00.000Z"),
              feeUsd: "0",
              idempotencyKey: "integration:valid-reversal",
              reversalOfEventId: "event-unknown-money",
              movements: {
                create: {
                  id: "movement-valid-reversal",
                  userAssetId: "integration-btc",
                  role: "PRINCIPAL",
                  quantityDelta: "-0.01",
                },
              },
            },
          });
          assert.equal(reversal.feeUsd.toString(), "0");
          await assert.rejects(
            client.portfolioEvent.delete({
              where: { id: "event-unknown-money" },
            }),
            /immutable/i,
          );
        },
      );

      await t.test(
        "an injected store failure rolls back openings and adoption",
        async () => {
          await client.user.create({
            data: {
              id: "auth0|rollback",
              name: "Rollback",
              email: "rollback@example.com",
            },
          });
          await client.userAsset.createMany({
            data: [
              {
                id: "rollback-btc",
                userId: "auth0|rollback",
                assetId: "bitcoin",
                assetName: "Rollback BTC",
                amount: 1,
              },
              {
                id: "rollback-eth",
                userId: "auth0|rollback",
                assetId: "ethereum",
                assetName: "Rollback ETH",
                amount: 2,
              },
            ],
          });

          const baseStore = createPostgresOpeningBalanceStore(client);
          const preview = await runOpeningBalanceConversion({
            store: baseStore,
            userId: "auth0|rollback",
          });
          let created = 0;
          const failingStore = {
            ...baseStore,
            async createOpening(...args) {
              await baseStore.createOpening(...args);
              created += 1;
              if (created === 1) {
                throw new Error("injected PostgreSQL rollback");
              }
            },
          };

          await assert.rejects(
            runOpeningBalanceConversion({
              store: failingStore,
              userId: "auth0|rollback",
              adoptionAt,
              expectedFingerprint: preview.legacyFingerprint,
              apply: true,
            }),
            /injected PostgreSQL rollback/,
          );
          assert.equal(
            await client.portfolioEvent.count({
              where: { userId: "auth0|rollback" },
            }),
            0,
          );
          assert.equal(
            (await client.user.findUnique({ where: { id: "auth0|rollback" } }))
              .ledgerAdoptedAt,
            null,
          );
        },
      );

      await t.test(
        "an awaited constraint flush rejects malformed openings and rolls back",
        async () => {
          await client.user.create({
            data: {
              id: "auth0|flush",
              name: "Constraint flush",
              email: "constraint-flush@example.com",
            },
          });
          await client.userAsset.create({
            data: {
              id: "flush-btc",
              userId: "auth0|flush",
              assetId: "bitcoin",
              assetName: "Flush BTC",
              amount: 1,
            },
          });

          const baseStore = createPostgresOpeningBalanceStore(client);
          const preview = await runOpeningBalanceConversion({
            store: baseStore,
            userId: "auth0|flush",
          });
          const malformedStore = {
            ...baseStore,
            async createOpening(transaction, options) {
              await baseStore.createOpening(transaction, options);
              const [event] = await transaction.$queryRawUnsafe(
                `SELECT "id"
               FROM "PortfolioEvent"
               WHERE "userId" = $1 AND "idempotencyKey" = $2`,
                options.userId,
                options.position.idempotencyKey,
              );
              await transaction.$executeRawUnsafe(
                `INSERT INTO "AssetMovement" (
                "id", "userId", "portfolioEventId", "userAssetId", "role", "quantityDelta"
               ) VALUES (
                'flush-extra-movement', $1, $2, $3, 'FEE', -1
               )`,
                options.userId,
                event.id,
                options.position.id,
              );
            },
          };

          await assert.rejects(
            runOpeningBalanceConversion({
              store: malformedStore,
              userId: "auth0|flush",
              adoptionAt,
              expectedFingerprint: preview.legacyFingerprint,
              apply: true,
            }),
            /requires exactly one positive principal movement/i,
          );
          assert.equal(
            await client.portfolioEvent.count({
              where: { userId: "auth0|flush" },
            }),
            0,
          );
          assert.equal(
            (await client.user.findUnique({ where: { id: "auth0|flush" } }))
              .ledgerAdoptedAt,
            null,
          );
        },
      );

      await t.test(
        "deferred opening constraints reject incomplete and wrong linkage at commit",
        () => {
          const cases = [
            `BEGIN;
           INSERT INTO "PortfolioEvent" (
             "id", "userId", "kind", "occurredAt", "externalFlowUsd", "feeUsd",
             "idempotencyKey", "openingForUserAssetId"
           ) VALUES (
             'event-missing', 'auth0|integration', 'OPENING_BALANCE',
             '2026-08-21 05:00:00', 0, 0, 'integration:event-missing',
             'integration-missing'
           );
           COMMIT;`,
            `BEGIN;
           INSERT INTO "PortfolioEvent" (
             "id", "userId", "kind", "occurredAt", "externalFlowUsd", "feeUsd",
             "idempotencyKey", "openingForUserAssetId"
           ) VALUES (
             'event-duplicate', 'auth0|integration', 'OPENING_BALANCE',
             '2026-08-21 05:00:00', 0, 0, 'integration:event-duplicate',
             'integration-duplicate'
           );
           INSERT INTO "AssetMovement" (
             "id", "userId", "portfolioEventId", "userAssetId", "role", "quantityDelta"
           ) VALUES
             ('movement-duplicate-1', 'auth0|integration', 'event-duplicate',
              'integration-duplicate', 'PRINCIPAL', 1),
             ('movement-duplicate-2', 'auth0|integration', 'event-duplicate',
              'integration-duplicate', 'FEE', -1);
           COMMIT;`,
            `BEGIN;
           INSERT INTO "PortfolioEvent" (
             "id", "userId", "kind", "occurredAt", "externalFlowUsd", "feeUsd",
             "idempotencyKey", "openingForUserAssetId"
           ) VALUES (
             'event-wrong-position', 'auth0|integration', 'OPENING_BALANCE',
             '2026-08-21 05:00:00', 0, 0, 'integration:event-wrong-position',
             'integration-wrong-opening'
           );
           INSERT INTO "AssetMovement" (
             "id", "userId", "portfolioEventId", "userAssetId", "quantityDelta"
           ) VALUES (
             'movement-wrong-position', 'auth0|integration',
             'event-wrong-position', 'integration-wrong-target', 1
           );
           COMMIT;`,
          ];

          for (const sql of cases) {
            const result = psqlCommand(ledgerPsqlUrl, sql);
            assert.notEqual(result.status, 0);
            assert.match(
              result.stderr,
              /requires exactly one positive principal movement/i,
            );
          }
        },
      );

      await t.test(
        "opening retry ignores valid later ledger activity",
        async () => {
          await client.userAsset.update({
            where: { id: "integration-btc" },
            data: { assetName: "Integration BTC renamed" },
          });
          await client.userAsset.create({
            data: {
              id: "integration-sol-after-adoption",
              userId: "auth0|integration",
              assetId: "solana",
              assetName: "Integration SOL after adoption",
              ledgerInitialAssetName: "Integration SOL after adoption",
              amount: 0,
              date: new Date("2026-08-22T02:59:00.000Z"),
              archivedAt: new Date("2026-08-22T02:59:00.000Z"),
            },
          });
          await client.portfolioEvent.create({
            data: {
              id: "integration-later-buy",
              userId: "auth0|integration",
              kind: "BUY",
              occurredAt: new Date("2026-08-22T03:00:00.000Z"),
              actualValueUsd: null,
              externalFlowUsd: null,
              feeUsd: "0",
              idempotencyKey: "11111111-1111-4111-8111-111111111111",
              movements: {
                create: {
                  id: "integration-later-buy-movement",
                  userAssetId: "integration-sol-after-adoption",
                  role: "PRINCIPAL",
                  quantityDelta: "0.01",
                },
              },
            },
          });

          const retryDryRun = parseCli(
            cli(ledgerPrismaUrl, [
              "--user-id",
              "auth0|integration",
              "--adoption-at",
              adoptionAt,
            ]),
            "opening dry run after activity",
          );
          const retryApply = parseCli(
            cli(ledgerPrismaUrl, [
              "--user-id",
              "auth0|integration",
              "--apply",
              "--adoption-at",
              adoptionAt,
              "--expected-fingerprint",
              dryRun.legacyFingerprint,
            ]),
            "opening apply retry after activity",
          );
          assert.equal(retryDryRun.alreadyAdopted, true);
          assert.equal(
            retryDryRun.openingFingerprint,
            applied.openingFingerprint,
          );
          assert.equal(retryApply.alreadyApplied, true);
          assert.equal(
            retryApply.openingFingerprint,
            applied.openingFingerprint,
          );
        },
      );

      await t.test(
        "verification accepts the exact catalog and converted data",
        () => {
          const withoutRetryExpectation = psqlFile(
            ledgerPsqlUrl,
            "scripts/portfolio-ledger/verify.sql",
            {
              user_id: "auth0|integration",
              adoption_at: adoptionAt,
              expected_legacy_fingerprint: dryRun.legacyFingerprint,
              expected_archive_fingerprint: emptySha256,
            },
          );
          expectSuccess(
            withoutRetryExpectation,
            "ledger verification without retry expectation",
          );
          assert.match(
            withoutRetryExpectation.stdout,
            /verified_legacy_fingerprint/,
          );
          assert.match(withoutRetryExpectation.stdout, /opening_fingerprint/);
          assert.ok(
            withoutRetryExpectation.stdout.includes(dryRun.legacyFingerprint),
          );
          assert.ok(
            withoutRetryExpectation.stdout.includes(applied.openingFingerprint),
          );

          const result = psqlFile(
            ledgerPsqlUrl,
            "scripts/portfolio-ledger/verify.sql",
            {
              user_id: "auth0|integration",
              adoption_at: adoptionAt,
              expected_legacy_fingerprint: dryRun.legacyFingerprint,
              expected_archive_fingerprint: emptySha256,
              expected_opening_fingerprint: applied.openingFingerprint,
            },
          );
          expectSuccess(result, "ledger verification");
          assert.ok(result.stdout.includes(dryRun.legacyFingerprint));
          assert.ok(result.stdout.includes(applied.openingFingerprint));

          const changedOpening = psqlFile(
            ledgerPsqlUrl,
            "scripts/portfolio-ledger/verify.sql",
            {
              user_id: "auth0|integration",
              adoption_at: adoptionAt,
              expected_legacy_fingerprint: dryRun.legacyFingerprint,
              expected_archive_fingerprint: emptySha256,
              expected_opening_fingerprint: "0".repeat(64),
            },
          );
          assert.notEqual(changedOpening.status, 0);
          assert.match(
            changedOpening.stderr,
            /Opening fingerprint changed after retry/,
          );

          const changedLegacy = psqlFile(
            ledgerPsqlUrl,
            "scripts/portfolio-ledger/verify.sql",
            {
              user_id: "auth0|integration",
              adoption_at: adoptionAt,
              expected_legacy_fingerprint: "0".repeat(64),
              expected_archive_fingerprint: emptySha256,
            },
          );
          assert.notEqual(changedLegacy.status, 0);
          assert.match(changedLegacy.stderr, /Legacy fingerprint changed/);
        },
      );

      await t.test("preflight rejects timestamp precision drift", () => {
        expectSuccess(
          psqlFile(
            baselinePsqlUrl,
            "prisma/migrations/20260820120000_legacy_baseline/migration.sql",
          ),
          "baseline migration fixture",
        );
        expectSuccess(
          psqlCommand(
            baselinePsqlUrl,
            `INSERT INTO "User" (id, name, email)
             VALUES ('auth0|baseline', 'Baseline', 'baseline@example.com')`,
          ),
          "baseline user fixture",
        );
        expectSuccess(
          psqlFile(baselinePsqlUrl, "scripts/portfolio-ledger/preflight.sql", {
            user_id: "auth0|baseline",
          }),
          "valid baseline preflight",
        );
        expectSuccess(
          psqlCommand(
            baselinePsqlUrl,
            `ALTER TABLE "UserAsset"
               ALTER COLUMN "date" TYPE TIMESTAMP(6)`,
          ),
          "timestamp precision drift fixture",
        );
        const malformed = psqlFile(
          baselinePsqlUrl,
          "scripts/portfolio-ledger/preflight.sql",
          { user_id: "auth0|baseline" },
        );
        assert.notEqual(malformed.status, 0);
        assert.match(malformed.stderr, /Legacy baseline mismatch/);
        expectSuccess(
          psqlCommand(
            baselinePsqlUrl,
            `ALTER TABLE "UserAsset"
               ALTER COLUMN "date" TYPE TIMESTAMP(3)`,
          ),
          "restore baseline timestamp precision",
        );
        expectSuccess(
          psqlFile(baselinePsqlUrl, "scripts/portfolio-ledger/preflight.sql", {
            user_id: "auth0|baseline",
          }),
          "restored baseline preflight",
        );
      });

      await t.test(
        "preflight rejects a same-name index on the wrong column",
        () => {
          expectSuccess(
            psqlCommand(
              baselinePsqlUrl,
              `DROP INDEX "UserAsset_assetId_idx";
             CREATE INDEX "UserAsset_assetId_idx" ON "UserAsset"("assetName")`,
            ),
            "malformed baseline index fixture",
          );
          const malformed = psqlFile(
            baselinePsqlUrl,
            "scripts/portfolio-ledger/preflight.sql",
            { user_id: "auth0|baseline" },
          );
          assert.notEqual(malformed.status, 0);
          assert.match(malformed.stderr, /Legacy baseline mismatch/);
        },
      );

      await t.test(
        "verification rejects a same-name trigger with a false predicate",
        () => {
          expectSuccess(
            psqlCommand(
              ledgerPsqlUrl,
              `DROP TRIGGER "PortfolioEvent_exactly_one_opening_movement_check"
                 ON "PortfolioEvent";
               CREATE CONSTRAINT TRIGGER "PortfolioEvent_exactly_one_opening_movement_check"
                 AFTER INSERT OR UPDATE OR DELETE ON "PortfolioEvent"
                 DEFERRABLE INITIALLY DEFERRED
                 FOR EACH ROW
                 WHEN (false)
                 EXECUTE FUNCTION "enforce_opening_event_movement"()`,
            ),
            "malformed trigger fixture",
          );

          const malformed = psqlFile(
            ledgerPsqlUrl,
            "scripts/portfolio-ledger/verify.sql",
            {
              user_id: "auth0|integration",
              adoption_at: adoptionAt,
              expected_legacy_fingerprint: dryRun.legacyFingerprint,
              expected_archive_fingerprint: emptySha256,
            },
          );
          assert.notEqual(malformed.status, 0);
          assert.match(malformed.stderr, /Ledger schema mismatch/);

          expectSuccess(
            psqlCommand(
              ledgerPsqlUrl,
              `DROP TRIGGER "PortfolioEvent_exactly_one_opening_movement_check"
                 ON "PortfolioEvent";
               CREATE CONSTRAINT TRIGGER "PortfolioEvent_exactly_one_opening_movement_check"
                 AFTER INSERT OR UPDATE OR DELETE ON "PortfolioEvent"
                 DEFERRABLE INITIALLY DEFERRED
                 FOR EACH ROW
                 EXECUTE FUNCTION "enforce_opening_event_movement"()`,
            ),
            "restore exact trigger fixture",
          );
          expectSuccess(
            psqlFile(ledgerPsqlUrl, "scripts/portfolio-ledger/verify.sql", {
              user_id: "auth0|integration",
              adoption_at: adoptionAt,
              expected_legacy_fingerprint: dryRun.legacyFingerprint,
              expected_archive_fingerprint: emptySha256,
              expected_opening_fingerprint: applied.openingFingerprint,
            }),
            "restored exact trigger verification",
          );
        },
      );

      await t.test(
        "verification rejects a same-name weakened owner foreign key",
        async () => {
          await client.$executeRawUnsafe(
            `ALTER TABLE "AssetMovement"
             DROP CONSTRAINT "AssetMovement_userAssetId_userId_fkey"`,
          );
          await client.$executeRawUnsafe(
            `ALTER TABLE "AssetMovement"
             ADD CONSTRAINT "AssetMovement_userAssetId_userId_fkey"
             FOREIGN KEY ("userAssetId") REFERENCES "UserAsset"("id")
             ON DELETE RESTRICT ON UPDATE CASCADE`,
          );

          const malformed = psqlFile(
            ledgerPsqlUrl,
            "scripts/portfolio-ledger/verify.sql",
            {
              user_id: "auth0|integration",
              adoption_at: adoptionAt,
              expected_legacy_fingerprint: dryRun.legacyFingerprint,
              expected_archive_fingerprint: emptySha256,
            },
          );
          assert.notEqual(malformed.status, 0);
          assert.match(malformed.stderr, /Ledger schema mismatch/);
        },
      );
    } finally {
      await client?.$disconnect();
      for (const schema of [ledgerSchema, baselineSchema]) {
        await admin.$executeRawUnsafe(
          `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
        );
      }
      await admin.$disconnect();
    }
  });
}
