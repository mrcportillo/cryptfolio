import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { createOwnedAsset } from "../src/services/asset/mutations.ts";
import { readPortfolioHome } from "../src/services/asset/cutover-queries.ts";
import { databaseDecimalToPlain } from "../src/services/portfolio-transactions/decimal.ts";
import { createPostgresTransactionStore } from "../src/services/portfolio-transactions/postgres.ts";
import {
  correctTransaction,
  deterministicPositionId,
  recordTransaction,
  reverseTransaction,
} from "../src/services/portfolio-transactions/service.ts";
import {
  findOwnedPortfolioEvent,
  listOwnedPortfolioEvents,
  listOwnedTransactionPositions,
} from "../src/services/portfolio-transactions/queries.ts";
import { createPostgresOpeningBalanceStore } from "../scripts/portfolio-ledger/opening-balances.mjs";
import { runOpeningBalanceConversion } from "../scripts/portfolio-ledger/opening-balances-lib.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const configuredUrl = process.env.CRYPTFOLIO_LEDGER_TEST_DATABASE_URL;
const required = process.env.CRYPTFOLIO_REQUIRE_LEDGER_TEST_DATABASE === "1";
const adoptionAt = "2026-08-20T12:00:00.000Z";
const now = new Date("2026-08-25T12:00:00.000Z");

function validateDisposableDatabaseUrl(value) {
  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  assert.match(url.protocol, /^postgres(?:ql)?:$/);
  assert.ok(
    new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(url.hostname),
    "test URL must use a loopback host",
  );
  assert.match(databaseName, /cryptfolio.*test/i);
  return url;
}

function schemaName() {
  return `cryptfolio_transactions_test_${process.pid}_${randomBytes(4).toString("hex")}`;
}

function prismaUrl(baseUrl, schema) {
  const url = new URL(baseUrl);
  url.searchParams.delete("options");
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

async function createUserWithPositions(client, id, quantities) {
  await client.user.create({
    data: {
      id,
      name: id,
      email: `${id.replace(/[^a-z0-9]/gi, "-")}@example.com`,
    },
  });
  await client.userAsset.createMany({
    data: Object.entries(quantities).map(([positionId, amount]) => ({
      id: `${id}:${positionId}`,
      userId: id,
      assetId: positionId,
      assetName: positionId.toUpperCase(),
      amount,
      date: new Date("2026-08-20T11:00:00.000Z"),
    })),
  });
}

async function adopt(client, userId) {
  const store = createPostgresOpeningBalanceStore(client);
  const preview = await runOpeningBalanceConversion({ store, userId });
  return runOpeningBalanceConversion({
    store,
    userId,
    adoptionAt,
    expectedFingerprint: preview.legacyFingerprint,
    apply: true,
  });
}

function position(userId, assetId) {
  return `${userId}:${assetId}`;
}

function intent(kind, fields = {}) {
  return {
    kind,
    occurredAt: "2026-08-21T12:00:00.000Z",
    idempotencyKey: randomUUID(),
    ...fields,
  };
}

function asReplacement(transactionIntent) {
  const { idempotencyKey: _discarded, ...replacement } = transactionIntent;
  return replacement;
}

async function balance(client, userId, assetId) {
  const result = await client.assetMovement.aggregate({
    where: { userId, userAssetId: position(userId, assetId) },
    _sum: { quantityDelta: true },
  });
  return result._sum.quantityDelta
    ? databaseDecimalToPlain(result._sum.quantityDelta)
    : "0";
}

async function waitForBlockedTransaction(client, label) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const [result] = await client.$queryRawUnsafe(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity activity
        WHERE activity.pid <> pg_backend_pid()
          AND cardinality(pg_blocking_pids(activity.pid)) > 0
      ) AS "blocked"
    `);
    if (result.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`${label} never reached the forced database lock wait.`);
}

if (!configuredUrl) {
  test(
    "manual transaction PostgreSQL integration requires an explicit disposable URL",
    { skip: !required },
    () => {
      assert.fail(
        "Set CRYPTFOLIO_LEDGER_TEST_DATABASE_URL to a loopback PostgreSQL database whose name contains cryptfolio and test.",
      );
    },
  );
} else {
  test("manual transactions work against disposable PostgreSQL", async (t) => {
    const baseUrl = validateDisposableDatabaseUrl(configuredUrl);
    const schema = schemaName();
    assert.match(schema, /^cryptfolio_transactions_test_[a-z0-9_]+$/);
    const adminUrl = prismaUrl(baseUrl, "public");
    const databaseUrl = prismaUrl(baseUrl, schema);
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    let client;

    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);

      await t.test("migrations deploy with no Prisma drift", () => {
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

      await t.test(
        "all economic intents persist their signed, crypto-only shapes",
        async () => {
          const userId = "auth0|intent-shapes";
          await createUserWithPositions(client, userId, {
            bitcoin: 2,
            ethereum: 5,
          });
          await adopt(client, userId);
          const store = createPostgresTransactionStore(client);

          const buy = await recordTransaction(
            store,
            userId,
            intent("BUY", {
              position: {
                userAssetId: position(userId, "bitcoin"),
                quantity: "0.5",
              },
              actualValueUsd: "100",
              fee: {
                userAssetId: position(userId, "ethereum"),
                quantity: "0.1",
                valueUsd: "10",
              },
            }),
            now,
          );
          const sell = await recordTransaction(
            store,
            userId,
            intent("SELL", {
              position: {
                userAssetId: position(userId, "bitcoin"),
                quantity: "0.25",
              },
              actualValueUsd: "50",
            }),
            now,
          );
          const transferIn = await recordTransaction(
            store,
            userId,
            intent("TRANSFER_IN", {
              position: {
                userAssetId: position(userId, "ethereum"),
                quantity: "1",
              },
            }),
            now,
          );
          const transferOut = await recordTransaction(
            store,
            userId,
            intent("TRANSFER_OUT", {
              position: {
                userAssetId: position(userId, "ethereum"),
                quantity: "0.4",
              },
              actualValueUsd: "40",
            }),
            now,
          );
          const swap = await recordTransaction(
            store,
            userId,
            intent("SWAP", {
              from: {
                userAssetId: position(userId, "bitcoin"),
                quantity: "0.5",
              },
              to: { userAssetId: position(userId, "ethereum"), quantity: "2" },
              actualValueUsd: "75",
              fee: {
                userAssetId: position(userId, "ethereum"),
                quantity: "0.1",
              },
            }),
            now,
          );
          const fee = await recordTransaction(
            store,
            userId,
            intent("FEE", {
              fee: {
                userAssetId: position(userId, "ethereum"),
                quantity: "0.4",
                valueUsd: "20",
              },
            }),
            now,
          );

          assert.equal(buy.actualValueUsd, "100");
          assert.equal(buy.externalFlowUsd, "100");
          assert.equal(buy.feeUsd, "10");
          assert.equal(sell.externalFlowUsd, "-50");
          assert.equal(transferIn.externalFlowUsd, null);
          assert.equal(transferIn.feeUsd, "0");
          assert.equal(transferOut.externalFlowUsd, "-40");
          assert.equal(swap.externalFlowUsd, "0");
          assert.equal(swap.feeUsd, null);
          assert.equal(fee.externalFlowUsd, "0");
          assert.equal(fee.feeUsd, "20");
          assert.equal(await balance(client, userId, "bitcoin"), "1.75");
          assert.equal(await balance(client, userId, "ethereum"), "7");
        },
      );

      await t.test(
        "minimum-scale decimals remain plain through every ledger read boundary",
        async () => {
          const userId = "auth0|minimum-scale-decimals";
          const tiny = "0.000000000000000000000000000001";
          const twiceTiny = "0.000000000000000000000000000002";
          const threeTiny = "0.000000000000000000000000000003";
          await createUserWithPositions(client, userId, { bitcoin: 1e-30 });
          await adopt(client, userId);
          const transactionStore = createPostgresTransactionStore(client);
          const firstBuy = await recordTransaction(
            transactionStore,
            userId,
            intent("BUY", {
              actualValueUsd: tiny,
              position: {
                userAssetId: position(userId, "bitcoin"),
                quantity: tiny,
              },
            }),
            now,
          );
          assert.equal(firstBuy.actualValueUsd, tiny);
          assert.equal(firstBuy.externalFlowUsd, tiny);
          assert.equal(firstBuy.movements[0].quantityDelta, tiny);

          const [detail, page, initialCatalog] = await Promise.all([
            findOwnedPortfolioEvent(client, userId, firstBuy.id),
            listOwnedPortfolioEvents(client, userId, {
              page: 1,
              pageSize: 20,
            }),
            listOwnedTransactionPositions(client, userId),
          ]);
          assert.equal(detail.actualValueUsd, tiny);
          assert.equal(detail.movements[0].quantityDelta, tiny);
          assert.equal(
            page.events.find(({ id }) => id === firstBuy.id).actualValueUsd,
            tiny,
          );
          assert.equal(initialCatalog.positions[0].balance, twiceTiny);

          const reversed = await reverseTransaction(
            transactionStore,
            userId,
            firstBuy.id,
            randomUUID(),
            now,
          );
          assert.equal(reversed.actualValueUsd, `-${tiny}`);
          assert.equal(reversed.externalFlowUsd, `-${tiny}`);
          assert.equal(reversed.movements[0].quantityDelta, `-${tiny}`);

          const secondBuy = await recordTransaction(
            transactionStore,
            userId,
            intent("BUY", {
              actualValueUsd: tiny,
              position: {
                userAssetId: position(userId, "bitcoin"),
                quantity: tiny,
              },
            }),
            now,
          );
          const corrected = await correctTransaction(
            transactionStore,
            userId,
            {
              eventId: secondBuy.id,
              idempotencyKey: randomUUID(),
              replacement: {
                kind: "BUY",
                occurredAt: "2026-08-22T12:00:00.000Z",
                actualValueUsd: twiceTiny,
                position: {
                  userAssetId: position(userId, "bitcoin"),
                  quantity: twiceTiny,
                },
              },
            },
            now,
          );
          assert.equal(corrected.reversal.actualValueUsd, `-${tiny}`);
          assert.equal(
            corrected.reversal.movements[0].quantityDelta,
            `-${tiny}`,
          );
          assert.equal(corrected.replacement.actualValueUsd, twiceTiny);
          assert.equal(
            corrected.replacement.movements[0].quantityDelta,
            twiceTiny,
          );

          const [finalCatalog, home] = await Promise.all([
            listOwnedTransactionPositions(client, userId),
            readPortfolioHome(client, userId, { page: 1, pageSize: 10 }),
          ]);
          assert.equal(finalCatalog.positions[0].balance, threeTiny);
          assert.equal(home.assetsPage.assets[0].amount, threeTiny);
          assert.equal(home.holdings[0].amount, threeTiny);
          assert.equal(await balance(client, userId, "bitcoin"), threeTiny);

          const openingStore = createPostgresOpeningBalanceStore(client);
          const [openingRecord] = await client.$transaction((transaction) =>
            openingStore.getOpeningRecords(transaction, userId),
          );
          assert.equal(openingRecord.quantityDeltaText, tiny);
          assert.doesNotMatch(openingRecord.quantityDeltaText, /e/i);
          const openingRetry = await runOpeningBalanceConversion({
            store: openingStore,
            userId,
          });
          assert.equal(openingRetry.alreadyAdopted, true);
        },
      );

      await t.test(
        "inbound events create deterministic positions and expose an exact owner catalog",
        async () => {
          const userId = "auth0|new-positions";
          await createUserWithPositions(client, userId, { bitcoin: 1 });
          await adopt(client, userId);
          const store = createPostgresTransactionStore(client);
          const idempotencyKey = randomUUID();
          const request = intent("BUY", {
            idempotencyKey,
            position: {
              newPosition: { assetId: "solana", assetName: "SOL vault" },
              quantity: "3",
            },
          });
          const expectedId = deterministicPositionId(
            userId,
            idempotencyKey,
            "principal",
          );

          const created = await recordTransaction(store, userId, request, now);
          assert.equal(created.movements[0].userAssetId, expectedId);
          const retry = await recordTransaction(store, userId, request, now);
          assert.equal(retry.id, created.id);
          const seeded = await client.userAsset.findUnique({
            where: { id: expectedId },
          });
          assert.equal(seeded.amount, 0);
          assert.equal(seeded.archivedAt, null);
          assert.equal(
            await client.userAsset.count({ where: { id: expectedId, userId } }),
            1,
          );
          await client.userAsset.update({
            where: { id: expectedId },
            data: { assetName: "SOL renamed after recording" },
          });
          assert.equal(
            (await recordTransaction(store, userId, request, now)).id,
            created.id,
          );
          await assert.rejects(
            recordTransaction(
              store,
              userId,
              {
                ...request,
                position: {
                  newPosition: {
                    assetId: "solana",
                    assetName: "Reused key, other alias",
                  },
                  quantity: "3",
                },
              },
              now,
            ),
            (error) => error.code === "DUPLICATE_KEY",
          );

          const correctionKey = randomUUID();
          const correctedId = deterministicPositionId(
            userId,
            `replace:${correctionKey}`,
            "principal",
          );
          const corrected = await correctTransaction(
            store,
            userId,
            {
              eventId: created.id,
              idempotencyKey: correctionKey,
              replacement: {
                kind: "BUY",
                occurredAt: "2026-08-22T12:00:00.000Z",
                position: {
                  newPosition: {
                    assetId: "avalanche-2",
                    assetName: "AVAX corrected",
                  },
                  quantity: "2",
                },
              },
            },
            now,
          );
          assert.equal(
            corrected.replacement.movements[0].userAssetId,
            correctedId,
          );
          assert.ok(
            (await client.userAsset.findUnique({ where: { id: expectedId } }))
              .archivedAt,
          );
          assert.equal(
            (await client.userAsset.findUnique({ where: { id: correctedId } }))
              .archivedAt,
            null,
          );

          const failedSwapKey = randomUUID();
          const failedDestinationId = deterministicPositionId(
            userId,
            failedSwapKey,
            "swap-destination",
          );
          await assert.rejects(
            recordTransaction(
              store,
              userId,
              intent("SWAP", {
                idempotencyKey: failedSwapKey,
                from: {
                  userAssetId: position(userId, "bitcoin"),
                  quantity: "5",
                },
                to: {
                  newPosition: { assetId: "dogecoin", assetName: "DOGE" },
                  quantity: "100",
                },
              }),
              now,
            ),
            (error) => error.code === "NEGATIVE_BALANCE",
          );
          assert.equal(
            await client.userAsset.count({
              where: { id: failedDestinationId },
            }),
            0,
          );

          await client.userAsset.create({
            data: {
              id: `${userId}:archived-zero`,
              userId,
              assetId: "ethereum",
              assetName: "ETH old",
              ledgerInitialAssetName: "ETH old",
              amount: 0,
              archivedAt: now,
            },
          });
          const catalog = await listOwnedTransactionPositions(client, userId);
          assert.equal(catalog.ledgerAdopted, true);
          assert.deepEqual(
            catalog.positions
              .map(({ id, balance, canSpend }) => ({
                id,
                balance,
                canSpend,
              }))
              .sort((left, right) => left.id.localeCompare(right.id)),
            [
              { id: `${userId}:archived-zero`, balance: "0", canSpend: false },
              {
                id: position(userId, "bitcoin"),
                balance: "1",
                canSpend: true,
              },
              { id: correctedId, balance: "2", canSpend: true },
              { id: expectedId, balance: "0", canSpend: false },
            ].sort((left, right) => left.id.localeCompare(right.id)),
          );
          const home = await readPortfolioHome(client, userId, {
            page: 1,
            pageSize: 10,
          });
          assert.equal(home.ledgerAdoptedAt.toISOString(), adoptionAt);
          assert.deepEqual(
            home.holdings
              .map(({ assetId, amount }) => ({ assetId, amount }))
              .sort((left, right) => left.assetId.localeCompare(right.assetId)),
            [
              { assetId: "avalanche-2", amount: "2" },
              { assetId: "bitcoin", amount: "1" },
            ],
          );
        },
      );

      await t.test(
        "idempotency and owner-scoped reads do not leak events",
        async () => {
          const userId = "auth0|idempotency";
          const otherId = "auth0|idempotency-other";
          await createUserWithPositions(client, userId, { bitcoin: 1 });
          await createUserWithPositions(client, otherId, { bitcoin: 1 });
          await adopt(client, userId);
          await adopt(client, otherId);
          const store = createPostgresTransactionStore(client);
          const request = intent("BUY", {
            position: {
              userAssetId: position(userId, "bitcoin"),
              quantity: "0.1",
            },
          });
          const first = await recordTransaction(store, userId, request, now);
          const retry = await recordTransaction(store, userId, request, now);
          assert.equal(retry.id, first.id);
          assert.equal(
            await findOwnedPortfolioEvent(client, otherId, first.id),
            null,
          );
          const page = await listOwnedPortfolioEvents(client, userId, {
            page: 1,
            pageSize: 1,
          });
          assert.equal(page.events.length, 1);
          assert.equal(page.hasMore, true);
          await assert.rejects(
            reverseTransaction(store, otherId, first.id, randomUUID(), now),
            (error) => error.code === "NOT_FOUND",
          );
        },
      );

      await t.test(
        "concurrent and backdated overspends roll back",
        async () => {
          const concurrentId = "auth0|concurrent-spend";
          await createUserWithPositions(client, concurrentId, { bitcoin: 1 });
          await adopt(client, concurrentId);
          const store = createPostgresTransactionStore(client);
          const results = await Promise.allSettled([
            recordTransaction(
              store,
              concurrentId,
              intent("SELL", {
                position: {
                  userAssetId: position(concurrentId, "bitcoin"),
                  quantity: "0.75",
                },
              }),
              now,
            ),
            recordTransaction(
              store,
              concurrentId,
              intent("SELL", {
                position: {
                  userAssetId: position(concurrentId, "bitcoin"),
                  quantity: "0.75",
                },
              }),
              now,
            ),
          ]);
          assert.deepEqual(results.map(({ status }) => status).sort(), [
            "fulfilled",
            "rejected",
          ]);
          assert.equal(await balance(client, concurrentId, "bitcoin"), "0.25");

          const backdatedId = "auth0|backdated";
          await createUserWithPositions(client, backdatedId, { bitcoin: 0.5 });
          await adopt(client, backdatedId);
          await recordTransaction(
            store,
            backdatedId,
            intent("BUY", {
              occurredAt: "2026-08-22T12:00:00.000Z",
              position: {
                userAssetId: position(backdatedId, "bitcoin"),
                quantity: "1",
              },
            }),
            now,
          );
          await assert.rejects(
            recordTransaction(
              store,
              backdatedId,
              intent("SELL", {
                occurredAt: "2026-08-21T12:00:00.000Z",
                position: {
                  userAssetId: position(backdatedId, "bitcoin"),
                  quantity: "1",
                },
              }),
              now,
            ),
            (error) => error.code === "NEGATIVE_BALANCE",
          );
          assert.equal(await balance(client, backdatedId, "bitcoin"), "1.5");
        },
      );

      await t.test(
        "swap and correction failures are atomic; correction history is auditable",
        async () => {
          const userId = "auth0|atomic";
          await createUserWithPositions(client, userId, {
            bitcoin: 1,
            ethereum: 1,
          });
          await adopt(client, userId);
          const store = createPostgresTransactionStore(client);
          const beforeSwap = await client.portfolioEvent.count({
            where: { userId },
          });
          await assert.rejects(
            recordTransaction(
              store,
              userId,
              intent("SWAP", {
                from: {
                  userAssetId: position(userId, "bitcoin"),
                  quantity: "2",
                },
                to: {
                  userAssetId: position(userId, "ethereum"),
                  quantity: "5",
                },
              }),
              now,
            ),
            (error) => error.code === "NEGATIVE_BALANCE",
          );
          assert.equal(
            await client.portfolioEvent.count({ where: { userId } }),
            beforeSwap,
          );

          const sale = await recordTransaction(
            store,
            userId,
            intent("SELL", {
              position: {
                userAssetId: position(userId, "bitcoin"),
                quantity: "0.5",
              },
            }),
            now,
          );
          const corrected = await correctTransaction(
            store,
            userId,
            {
              eventId: sale.id,
              idempotencyKey: randomUUID(),
              replacement: asReplacement(
                intent("SELL", {
                  position: {
                    userAssetId: position(userId, "bitcoin"),
                    quantity: "0.25",
                  },
                }),
              ),
            },
            now,
          );
          assert.equal(corrected.reversal.reversalOfEventId, sale.id);
          assert.equal(corrected.replacement.replacementForEventId, sale.id);
          assert.equal(corrected.replacement.kind, sale.kind);

          const beforeInvalidCorrection = await client.portfolioEvent.count({
            where: { userId },
          });
          await assert.rejects(
            correctTransaction(
              store,
              userId,
              {
                eventId: corrected.replacement.id,
                idempotencyKey: randomUUID(),
                replacement: asReplacement(
                  intent("SELL", {
                    position: {
                      userAssetId: position(userId, "bitcoin"),
                      quantity: "5",
                    },
                  }),
                ),
              },
              now,
            ),
            (error) => error.code === "NEGATIVE_BALANCE",
          );
          assert.equal(
            await client.portfolioEvent.count({ where: { userId } }),
            beforeInvalidCorrection,
          );
        },
      );

      await t.test(
        "raw adoption and legacy insertion serialize on the owner row",
        async () => {
          const userId = "auth0|raw-adoption-race";
          await createUserWithPositions(client, userId, {});
          const results = await Promise.allSettled([
            client.user.update({
              where: { id: userId },
              data: { ledgerAdoptedAt: new Date(adoptionAt) },
            }),
            client.userAsset.create({
              data: {
                id: `${userId}:bitcoin`,
                userId,
                assetId: "bitcoin",
                assetName: "Racing BTC",
                amount: 1,
                date: new Date("2026-08-20T11:00:00.000Z"),
              },
            }),
          ]);
          assert.deepEqual(results.map(({ status }) => status).sort(), [
            "fulfilled",
            "rejected",
          ]);
          const [owner, positionCount] = await Promise.all([
            client.user.findUnique({ where: { id: userId } }),
            client.userAsset.count({ where: { userId } }),
          ]);
          assert.equal(
            owner.ledgerAdoptedAt !== null
              ? positionCount === 0
              : positionCount === 1,
            true,
          );
        },
      );

      await t.test(
        "database adoption boundary is validated once and permanently immutable",
        async () => {
          const futureUserId = "auth0|future-legacy-position";
          await createUserWithPositions(client, futureUserId, {});
          await client.userAsset.create({
            data: {
              id: `${futureUserId}:zero`,
              userId: futureUserId,
              assetId: "bitcoin",
              assetName: "Future-dated zero",
              amount: 0,
              date: new Date("2026-08-20T12:00:00.001Z"),
            },
          });
          await assert.rejects(
            client.user.update({
              where: { id: futureUserId },
              data: { ledgerAdoptedAt: new Date(adoptionAt) },
            }),
            /cannot precede a legacy position timestamp/i,
          );

          const userId = "auth0|adoption-guard";
          await createUserWithPositions(client, userId, { bitcoin: 1 });
          const legacyArchive = await client.assetArchive.create({
            data: {
              userAssetId: position(userId, "bitcoin"),
              amount: 1,
              date: new Date("2026-08-20T10:00:00.000Z"),
            },
          });

          await assert.rejects(
            client.user.update({
              where: { id: userId },
              data: { ledgerAdoptedAt: new Date(adoptionAt) },
            }),
            /missing an exact positive opening balance/i,
          );
          await assert.rejects(
            client.portfolioEvent.create({
              data: {
                userId,
                kind: "BUY",
                occurredAt: new Date("2026-08-21T12:00:00.000Z"),
                actualValueUsd: null,
                externalFlowUsd: null,
                feeUsd: "0",
                idempotencyKey: randomUUID(),
                movements: {
                  create: {
                    userAssetId: position(userId, "bitcoin"),
                    role: "PRINCIPAL",
                    quantityDelta: "0.1",
                  },
                },
              },
            }),
            /outside the adopted ledger boundary/i,
          );

          await adopt(client, userId);
          await assert.rejects(
            client.user.update({
              where: { id: userId },
              data: { ledgerAdoptedAt: null },
            }),
            /immutable once set/i,
          );
          await assert.rejects(
            client.user.update({
              where: { id: userId },
              data: {
                ledgerAdoptedAt: new Date("2026-08-20T12:01:00.000Z"),
              },
            }),
            /immutable once set/i,
          );
          await assert.rejects(
            client.portfolioEvent.create({
              data: {
                userId,
                kind: "BUY",
                occurredAt: new Date("2026-08-20T11:59:59.999Z"),
                actualValueUsd: null,
                externalFlowUsd: null,
                feeUsd: "0",
                idempotencyKey: randomUUID(),
                movements: {
                  create: {
                    userAssetId: position(userId, "bitcoin"),
                    role: "PRINCIPAL",
                    quantityDelta: "0.1",
                  },
                },
              },
            }),
            /outside the adopted ledger boundary/i,
          );

          const ownedPosition = position(userId, "bitcoin");
          await assert.rejects(
            client.userAsset.update({
              where: { id: ownedPosition },
              data: { amount: 2 },
            }),
            /frozen after adoption/i,
          );
          await assert.rejects(
            client.assetArchive.create({
              data: { userAssetId: ownedPosition, amount: 2, date: now },
            }),
            /frozen after adoption/i,
          );
          const adoptedZero = await client.userAsset.create({
            data: {
              id: `${userId}:zero-for-owner-escape`,
              userId,
              assetId: "ethereum",
              assetName: "Adopted zero",
              ledgerInitialAssetName: "Adopted zero",
              amount: 0,
              archivedAt: now,
            },
          });
          await assert.rejects(
            client.userAsset.update({
              where: { id: adoptedZero.id },
              data: { userId: futureUserId },
            }),
            /frozen after adoption/i,
          );
          await assert.rejects(
            client.assetArchive.update({
              where: { id: legacyArchive.id },
              data: { userAssetId: `${futureUserId}:zero` },
            }),
            /frozen after adoption/i,
          );
          const owner = await client.user.findUnique({ where: { id: userId } });
          assert.equal(owner.ledgerAdoptedAt.toISOString(), adoptionAt);
        },
      );

      await t.test(
        "zero archives, correction restores, and legacy fields stay frozen",
        async () => {
          const userId = "auth0|lifecycle";
          await createUserWithPositions(client, userId, { bitcoin: 1 });
          await adopt(client, userId);
          const store = createPostgresTransactionStore(client);
          const sale = await recordTransaction(
            store,
            userId,
            intent("SELL", {
              position: {
                userAssetId: position(userId, "bitcoin"),
                quantity: "1",
              },
            }),
            now,
          );
          assert.ok(
            (
              await client.userAsset.findUnique({
                where: { id: position(userId, "bitcoin") },
              })
            ).archivedAt,
          );
          await correctTransaction(
            store,
            userId,
            {
              eventId: sale.id,
              idempotencyKey: randomUUID(),
              replacement: asReplacement(
                intent("SELL", {
                  position: {
                    userAssetId: position(userId, "bitcoin"),
                    quantity: "0.25",
                  },
                }),
              ),
            },
            now,
          );
          const restored = await client.userAsset.findUnique({
            where: { id: position(userId, "bitcoin") },
          });
          assert.equal(restored.archivedAt, null);
          assert.equal(restored.amount, 1);

          await assert.rejects(
            client.userAsset.update({
              where: { id: restored.id },
              data: { amount: 42 },
            }),
            /frozen after adoption/i,
          );
          await assert.rejects(
            client.userAsset.create({
              data: {
                id: `${userId}:seeded-float`,
                userId,
                assetId: "ethereum",
                assetName: "Seeded legacy balance",
                amount: 42,
              },
            }),
            /must not seed the legacy Float amount/i,
          );
          await client.userAsset.create({
            data: {
              id: `${userId}:empty-ledger-position`,
              userId,
              assetId: "ethereum",
              assetName: "Future ledger position",
              ledgerInitialAssetName: "Future ledger position",
              amount: 0,
              archivedAt: now,
            },
          });
          await assert.rejects(
            client.assetArchive.create({
              data: { userAssetId: restored.id, amount: 1, date: now },
            }),
            /frozen after adoption/i,
          );
        },
      );

      await t.test(
        "the shared user lock closes the opening-conversion race",
        async () => {
          const userId = "auth0|cutover-race";
          await createUserWithPositions(client, userId, { bitcoin: 1 });
          const baseStore = createPostgresOpeningBalanceStore(client);
          const preview = await runOpeningBalanceConversion({
            store: baseStore,
            userId,
          });
          let release;
          const released = new Promise((resolve) => {
            release = resolve;
          });
          let signalLocked;
          const locked = new Promise((resolve) => {
            signalLocked = resolve;
          });
          const pausedStore = {
            ...baseStore,
            async lockUser(transaction, lockedUserId) {
              const user = await baseStore.lockUser(transaction, lockedUserId);
              signalLocked();
              await released;
              return user;
            },
          };
          const conversion = runOpeningBalanceConversion({
            store: pausedStore,
            userId,
            adoptionAt,
            expectedFingerprint: preview.legacyFingerprint,
            apply: true,
          });
          await locked;
          const legacyWriter = createOwnedAsset(client, {
            userId,
            assetId: "ethereum",
            assetName: "Late ETH",
            amount: 1,
          });
          release();
          await conversion;
          await assert.rejects(
            legacyWriter,
            (error) => error.code === "LEDGER_REQUIRED",
          );
          assert.equal(
            await client.userAsset.count({
              where: { userId, assetId: "ethereum" },
            }),
            0,
          );
        },
      );

      await t.test(
        "raw legacy writes force a stale opening conversion to retry",
        async () => {
          const userId = "auth0|raw-opening-conversion-race";
          await createUserWithPositions(client, userId, { bitcoin: 1 });
          const baseStore = createPostgresOpeningBalanceStore(client);
          const stalePreview = await runOpeningBalanceConversion({
            store: baseStore,
            userId,
          });
          let releaseRaw;
          const rawReleased = new Promise((resolve) => {
            releaseRaw = resolve;
          });
          let signalRawInserted;
          const rawInserted = new Promise((resolve) => {
            signalRawInserted = resolve;
          });
          const rawWriter = client.$transaction(async (transaction) => {
            await transaction.userAsset.create({
              data: {
                id: position(userId, "ethereum"),
                userId,
                assetId: "ethereum",
                assetName: "Late ETH",
                amount: 1,
                date: new Date("2026-08-20T11:00:00.000Z"),
              },
            });
            signalRawInserted();
            await rawReleased;
          });

          await rawInserted;
          let conversionAttempts = 0;
          const observedStore = {
            ...baseStore,
            async lockUser(transaction, lockedUserId) {
              conversionAttempts += 1;
              return baseStore.lockUser(transaction, lockedUserId);
            },
          };
          const staleConversion = runOpeningBalanceConversion({
            store: observedStore,
            userId,
            adoptionAt,
            expectedFingerprint: stalePreview.legacyFingerprint,
            apply: true,
          });
          try {
            await waitForBlockedTransaction(client, "opening conversion");
          } finally {
            releaseRaw();
          }
          const [writerResult, conversionResult] = await Promise.allSettled([
            rawWriter,
            staleConversion,
          ]);
          assert.equal(writerResult.status, "fulfilled");
          assert.equal(conversionResult.status, "rejected");
          assert.match(conversionResult.reason.message, /fingerprint changed/i);
          assert.ok(conversionAttempts >= 2);
          assert.equal(
            (await client.user.findUnique({ where: { id: userId } }))
              .ledgerAdoptedAt,
            null,
          );

          const freshPreview = await runOpeningBalanceConversion({
            store: baseStore,
            userId,
          });
          await runOpeningBalanceConversion({
            store: baseStore,
            userId,
            adoptionAt,
            expectedFingerprint: freshPreview.legacyFingerprint,
            apply: true,
          });
          const positions = await client.userAsset.findMany({
            where: { userId },
            include: { openingEvent: { include: { movements: true } } },
          });
          assert.equal(positions.length, 2);
          for (const ownedPosition of positions) {
            assert.equal(
              ownedPosition.ledgerInitialAssetName,
              ownedPosition.assetName,
            );
            assert.equal(ownedPosition.openingEvent.movements.length, 1);
            assert.equal(
              ownedPosition.openingEvent.movements[0].quantityDelta.toString(),
              ownedPosition.amount.toString(),
            );
          }
        },
      );

      await t.test(
        "concurrent raw spends serialize before movement insertion",
        async () => {
          const userId = "auth0|raw-concurrent-timeline";
          await createUserWithPositions(client, userId, { bitcoin: 1 });
          await adopt(client, userId);
          let releaseFirst;
          const firstReleased = new Promise((resolve) => {
            releaseFirst = resolve;
          });
          let signalFirstInserted;
          const firstInserted = new Promise((resolve) => {
            signalFirstInserted = resolve;
          });
          const rawSpend = (eventId, pauseAfterInsert = false) =>
            client.$transaction(async (transaction) => {
              await transaction.portfolioEvent.create({
                data: {
                  id: eventId,
                  userId,
                  kind: "SELL",
                  occurredAt: new Date("2026-08-21T12:00:00.000Z"),
                  actualValueUsd: null,
                  externalFlowUsd: null,
                  feeUsd: "0",
                  idempotencyKey: randomUUID(),
                  movements: {
                    create: {
                      id: `${eventId}:movement`,
                      userAssetId: position(userId, "bitcoin"),
                      role: "PRINCIPAL",
                      quantityDelta: "-0.75",
                    },
                  },
                },
              });
              if (pauseAfterInsert) {
                signalFirstInserted();
                await firstReleased;
              }
              await transaction.$executeRawUnsafe(`
                SET CONSTRAINTS
                  "PortfolioEvent_manual_semantics_check",
                  "AssetMovement_manual_semantics_check",
                  "AssetMovement_nonnegative_timeline_check"
                IMMEDIATE
              `);
            });

          const first = rawSpend("raw-concurrent-sell-1", true);
          await firstInserted;
          const second = rawSpend("raw-concurrent-sell-2");
          try {
            await waitForBlockedTransaction(client, "second raw spend");
          } finally {
            releaseFirst();
          }
          const results = await Promise.allSettled([first, second]);
          assert.deepEqual(results.map(({ status }) => status).sort(), [
            "fulfilled",
            "rejected",
          ]);
          assert.equal(await balance(client, userId, "bitcoin"), "0.25");
          assert.equal(
            await client.portfolioEvent.count({
              where: { userId, kind: "SELL" },
            }),
            1,
          );
        },
      );

      await t.test(
        "raw and application spends cannot commit from different snapshots",
        async () => {
          const userId = "auth0|raw-app-concurrent-timeline";
          await createUserWithPositions(client, userId, { bitcoin: 1 });
          await adopt(client, userId);
          let releaseRaw;
          const rawReleased = new Promise((resolve) => {
            releaseRaw = resolve;
          });
          let signalRawInserted;
          const rawInserted = new Promise((resolve) => {
            signalRawInserted = resolve;
          });
          const rawSpend = client.$transaction(async (transaction) => {
            await transaction.portfolioEvent.create({
              data: {
                id: "raw-app-race-sell",
                userId,
                kind: "SELL",
                occurredAt: new Date("2026-08-21T12:00:00.000Z"),
                actualValueUsd: null,
                externalFlowUsd: null,
                feeUsd: "0",
                idempotencyKey: randomUUID(),
                movements: {
                  create: {
                    id: "raw-app-race-sell:movement",
                    userAssetId: position(userId, "bitcoin"),
                    role: "PRINCIPAL",
                    quantityDelta: "-0.75",
                  },
                },
              },
            });
            signalRawInserted();
            await rawReleased;
            await transaction.$executeRawUnsafe(`
              SET CONSTRAINTS
                "PortfolioEvent_manual_semantics_check",
                "AssetMovement_manual_semantics_check",
                "AssetMovement_nonnegative_timeline_check"
              IMMEDIATE
            `);
          });

          await rawInserted;
          const baseStore = createPostgresTransactionStore(client);
          let applicationAttempts = 0;
          const observedStore = {
            ...baseStore,
            async lockUser(transaction, lockedUserId) {
              applicationAttempts += 1;
              return baseStore.lockUser(transaction, lockedUserId);
            },
          };
          const applicationSpend = recordTransaction(
            observedStore,
            userId,
            intent("SELL", {
              position: {
                userAssetId: position(userId, "bitcoin"),
                quantity: "0.75",
              },
            }),
            now,
          );
          try {
            await waitForBlockedTransaction(client, "application spend");
          } finally {
            releaseRaw();
          }
          const [rawResult, applicationResult] = await Promise.allSettled([
            rawSpend,
            applicationSpend,
          ]);

          assert.equal(rawResult.status, "fulfilled");
          assert.equal(applicationResult.status, "rejected");
          assert.ok(applicationAttempts >= 2);
          assert.equal(await balance(client, userId, "bitcoin"), "0.25");
          assert.equal(
            await client.portfolioEvent.count({
              where: { userId, kind: "SELL" },
            }),
            1,
          );
        },
      );

      await t.test(
        "deferred database timeline invariant rejects raw overspends at flush",
        async () => {
          const userId = "auth0|raw-timeline";
          await createUserWithPositions(client, userId, { bitcoin: 1 });
          await adopt(client, userId);
          const before = await client.portfolioEvent.count({
            where: { userId },
          });

          await assert.rejects(
            client.$transaction(async (transaction) => {
              await transaction.portfolioEvent.create({
                data: {
                  userId,
                  kind: "SELL",
                  occurredAt: new Date("2026-08-21T12:00:00.000Z"),
                  actualValueUsd: null,
                  externalFlowUsd: null,
                  feeUsd: "0",
                  idempotencyKey: randomUUID(),
                  movements: {
                    create: {
                      userAssetId: position(userId, "bitcoin"),
                      role: "PRINCIPAL",
                      quantityDelta: "-2",
                    },
                  },
                },
              });
              await transaction.$executeRawUnsafe(
                'SET CONSTRAINTS "AssetMovement_nonnegative_timeline_check" IMMEDIATE',
              );
            }),
            /would make position .* negative/i,
          );
          assert.equal(
            await client.portfolioEvent.count({ where: { userId } }),
            before,
          );
          assert.equal(await balance(client, userId, "bitcoin"), "1");
        },
      );

      await t.test(
        "database constraints reject every non-finite authoritative numeric",
        async () => {
          const userId = "auth0|non-finite-numerics";
          await createUserWithPositions(client, userId, { bitcoin: 1 });
          await adopt(client, userId);
          const numericLiterals = ["NaN", "Infinity", "-Infinity"];
          const eventFields = [
            ["actualValueUsd", "actual_value"],
            ["externalFlowUsd", "external_flow"],
            ["feeUsd", "fee"],
          ];

          for (const [column, constraintSuffix] of eventFields) {
            for (const [index, literal] of numericLiterals.entries()) {
              const eventId = `non-finite-event-${constraintSuffix}-${index}`;
              const values = {
                actualValueUsd: "NULL",
                externalFlowUsd: "NULL",
                feeUsd: "0",
              };
              values[column] = `'${literal}'::numeric`;
              await assert.rejects(
                client.$executeRawUnsafe(`
                  INSERT INTO "PortfolioEvent" (
                    "id", "userId", "kind", "occurredAt",
                    "actualValueUsd", "externalFlowUsd", "feeUsd",
                    "idempotencyKey"
                  ) VALUES (
                    '${eventId}', '${userId}', 'BUY',
                    '2026-08-21T12:00:00Z'::timestamptz AT TIME ZONE 'UTC',
                    ${values.actualValueUsd}, ${values.externalFlowUsd},
                    ${values.feeUsd}, '${eventId}'
                  )
                `),
                literal === "NaN"
                  ? new RegExp(
                      `PortfolioEvent_finite_${constraintSuffix}_check`,
                      "i",
                    )
                  : undefined,
              );
            }
          }

          for (const [column, constraintSuffix] of [
            ["quantityDelta", "quantity"],
            ["unitPriceUsd", "unit_price"],
          ]) {
            for (const [index, literal] of numericLiterals.entries()) {
              const eventId = `non-finite-movement-${constraintSuffix}-${index}`;
              await assert.rejects(
                client.$transaction(async (transaction) => {
                  await transaction.$executeRawUnsafe(`
                    INSERT INTO "PortfolioEvent" (
                      "id", "userId", "kind", "occurredAt",
                      "actualValueUsd", "externalFlowUsd", "feeUsd",
                      "idempotencyKey"
                    ) VALUES (
                      '${eventId}', '${userId}', 'BUY',
                      '2026-08-21T12:00:00Z'::timestamptz AT TIME ZONE 'UTC',
                      NULL, NULL, 0, '${eventId}'
                    )
                  `);
                  const quantity =
                    column === "quantityDelta"
                      ? `'${literal}'::numeric`
                      : "0.1";
                  const unitPrice =
                    column === "unitPriceUsd"
                      ? `'${literal}'::numeric`
                      : "NULL";
                  await transaction.$executeRawUnsafe(`
                    INSERT INTO "AssetMovement" (
                      "id", "userId", "portfolioEventId", "userAssetId",
                      "role", "quantityDelta", "unitPriceUsd",
                      "priceEstimated"
                    ) VALUES (
                      '${eventId}:movement', '${userId}', '${eventId}',
                      '${position(userId, "bitcoin")}', 'PRINCIPAL',
                      ${quantity}, ${unitPrice}, false
                    )
                  `);
                }),
                literal === "NaN"
                  ? new RegExp(
                      `AssetMovement_finite_${constraintSuffix}_check`,
                      "i",
                    )
                  : undefined,
              );
            }
          }

          const legacyUserId = "auth0|non-finite-legacy-numerics";
          await createUserWithPositions(client, legacyUserId, {});
          for (const [index, literal] of numericLiterals.entries()) {
            await assert.rejects(
              client.$executeRawUnsafe(`
                INSERT INTO "UserAsset" (
                  "id", "userId", "assetId", "assetName", "amount", "date"
                ) VALUES (
                  'non-finite-position-${index}', '${legacyUserId}', 'bitcoin',
                  'BTC', '${literal}'::double precision,
                  '2026-08-20T11:00:00Z'::timestamptz AT TIME ZONE 'UTC'
                )
              `),
              literal === "NaN" ? /UserAsset_finite_amount_check/i : undefined,
            );
          }
          await client.userAsset.create({
            data: {
              id: "finite-legacy-position",
              userId: legacyUserId,
              assetId: "bitcoin",
              assetName: "BTC",
              amount: 1,
              date: new Date("2026-08-20T11:00:00.000Z"),
            },
          });
          for (const [index, literal] of numericLiterals.entries()) {
            await assert.rejects(
              client.$executeRawUnsafe(`
                INSERT INTO "AssetArchive" (
                  "id", "userAssetId", "amount", "date"
                ) VALUES (
                  'non-finite-archive-${index}', 'finite-legacy-position',
                  '${literal}'::double precision,
                  '2026-08-20T10:00:00Z'::timestamptz AT TIME ZONE 'UTC'
                )
              `),
              literal === "NaN"
                ? /AssetArchive_finite_amount_check/i
                : undefined,
            );
          }

          await client.$transaction(async (transaction) => {
            await transaction.$executeRawUnsafe(`
              INSERT INTO "PortfolioEvent" (
                "id", "userId", "kind", "occurredAt", "actualValueUsd",
                "externalFlowUsd", "feeUsd", "idempotencyKey", "createdAt"
              ) VALUES (
                'finite-ledger-event', '${userId}', 'BUY',
                '2026-08-21T12:00:00Z'::timestamptz AT TIME ZONE 'UTC',
                12.5, 12.5, 0, 'finite-ledger-event',
                '2026-08-21T12:00:01Z'::timestamptz AT TIME ZONE 'UTC'
              )
            `);
            await transaction.$executeRawUnsafe(`
              INSERT INTO "AssetMovement" (
                "id", "userId", "portfolioEventId", "userAssetId", "role",
                "quantityDelta", "unitPriceUsd", "priceEstimated", "createdAt"
              ) VALUES (
                'finite-ledger-movement', '${userId}', 'finite-ledger-event',
                '${position(userId, "bitcoin")}', 'PRINCIPAL', 0.1, NULL,
                false,
                '2026-08-21T12:00:01Z'::timestamptz AT TIME ZONE 'UTC'
              )
            `);
            await transaction.$executeRawUnsafe(`
              SET CONSTRAINTS
                "PortfolioEvent_manual_semantics_check",
                "AssetMovement_manual_semantics_check",
                "AssetMovement_nonnegative_timeline_check"
              IMMEDIATE
            `);
          });
          assert.equal(await balance(client, userId, "bitcoin"), "1.1");
        },
      );

      await t.test(
        "database constraints reject infinite authoritative timestamps",
        async () => {
          const userId = "auth0|non-finite-timestamps";
          await createUserWithPositions(client, userId, { bitcoin: 1 });
          await adopt(client, userId);
          for (const [index, literal] of ["infinity", "-infinity"].entries()) {
            await assert.rejects(
              client.$executeRawUnsafe(`
                INSERT INTO "PortfolioEvent" (
                  "id", "userId", "kind", "occurredAt", "actualValueUsd",
                  "externalFlowUsd", "feeUsd", "idempotencyKey"
                ) VALUES (
                  'infinite-occurred-${index}', '${userId}', 'BUY',
                  '${literal}'::timestamp, NULL, NULL, 0,
                  'infinite-occurred-${index}'
                )
              `),
              /PortfolioEvent_finite_occurred_at_check/i,
            );
            await assert.rejects(
              client.$executeRawUnsafe(`
                INSERT INTO "PortfolioEvent" (
                  "id", "userId", "kind", "occurredAt", "actualValueUsd",
                  "externalFlowUsd", "feeUsd", "idempotencyKey", "createdAt"
                ) VALUES (
                  'infinite-event-created-${index}', '${userId}', 'BUY',
                  '2026-08-21T12:00:00Z'::timestamptz AT TIME ZONE 'UTC',
                  NULL, NULL, 0, 'infinite-event-created-${index}',
                  '${literal}'::timestamp
                )
              `),
              /PortfolioEvent_finite_created_at_check/i,
            );
            await assert.rejects(
              client.$transaction(async (transaction) => {
                const eventId = `infinite-movement-created-${index}`;
                await transaction.$executeRawUnsafe(`
                  INSERT INTO "PortfolioEvent" (
                    "id", "userId", "kind", "occurredAt", "actualValueUsd",
                    "externalFlowUsd", "feeUsd", "idempotencyKey"
                  ) VALUES (
                    '${eventId}', '${userId}', 'BUY',
                    '2026-08-21T12:00:00Z'::timestamptz AT TIME ZONE 'UTC',
                    NULL, NULL, 0, '${eventId}'
                  )
                `);
                await transaction.$executeRawUnsafe(`
                  INSERT INTO "AssetMovement" (
                    "id", "userId", "portfolioEventId", "userAssetId", "role",
                    "quantityDelta", "unitPriceUsd", "priceEstimated",
                    "createdAt"
                  ) VALUES (
                    '${eventId}:movement', '${userId}', '${eventId}',
                    '${position(userId, "bitcoin")}', 'PRINCIPAL', 0.1, NULL,
                    false, '${literal}'::timestamp
                  )
                `);
              }),
              /AssetMovement_finite_created_at_check/i,
            );
          }

          const legacyUserId = "auth0|non-finite-legacy-timestamps";
          await createUserWithPositions(client, legacyUserId, {});
          for (const [index, literal] of ["infinity", "-infinity"].entries()) {
            await assert.rejects(
              client.$executeRawUnsafe(`
                UPDATE "User"
                SET "ledgerAdoptedAt" = '${literal}'::timestamp
                WHERE "id" = '${legacyUserId}'
              `),
              /User_finite_ledger_adopted_at_check/i,
            );
            await assert.rejects(
              client.$executeRawUnsafe(`
                INSERT INTO "UserAsset" (
                  "id", "userId", "assetId", "assetName", "amount", "date"
                ) VALUES (
                  'infinite-position-date-${index}', '${legacyUserId}',
                  'bitcoin', 'BTC', 0, '${literal}'::timestamp
                )
              `),
              /UserAsset_finite_date_check/i,
            );
            await assert.rejects(
              client.$executeRawUnsafe(`
                INSERT INTO "UserAsset" (
                  "id", "userId", "assetId", "assetName", "amount", "date",
                  "archivedAt"
                ) VALUES (
                  'infinite-position-archive-${index}', '${legacyUserId}',
                  'bitcoin', 'BTC', 0,
                  '2026-08-20T11:00:00Z'::timestamptz AT TIME ZONE 'UTC',
                  '${literal}'::timestamp
                )
              `),
              /UserAsset_finite_archived_at_check/i,
            );
          }
          await client.userAsset.create({
            data: {
              id: "finite-timestamp-position",
              userId: legacyUserId,
              assetId: "bitcoin",
              assetName: "BTC",
              amount: 1,
              date: new Date("2026-08-20T11:00:00.000Z"),
            },
          });
          for (const [index, literal] of ["infinity", "-infinity"].entries()) {
            await assert.rejects(
              client.$executeRawUnsafe(`
                INSERT INTO "AssetArchive" (
                  "id", "userAssetId", "amount", "date"
                ) VALUES (
                  'infinite-archive-date-${index}',
                  'finite-timestamp-position', 1, '${literal}'::timestamp
                )
              `),
              /AssetArchive_finite_date_check/i,
            );
          }
          await client.assetArchive.create({
            data: {
              id: "finite-timestamp-archive",
              userAssetId: "finite-timestamp-position",
              amount: 1,
              date: new Date("2026-08-20T10:00:00.000Z"),
            },
          });
        },
      );

      await t.test(
        "database constraints reject malformed and mutable ledger records",
        async () => {
          const userId = "auth0|db-constraints";
          await createUserWithPositions(client, userId, {
            bitcoin: 1,
            ethereum: 1,
          });
          await adopt(client, userId);
          await assert.rejects(
            client.portfolioEvent.create({
              data: {
                userId,
                kind: "SWAP",
                occurredAt: new Date("2026-08-21T12:00:00.000Z"),
                actualValueUsd: "5",
                externalFlowUsd: "0",
                feeUsd: "0",
                idempotencyKey: randomUUID(),
                movements: {
                  create: {
                    userAssetId: position(userId, "bitcoin"),
                    role: "PRINCIPAL",
                    quantityDelta: "-0.1",
                  },
                },
              },
            }),
            /invalid shape/i,
          );
          const event = await recordTransaction(
            createPostgresTransactionStore(client),
            userId,
            intent("BUY", {
              position: {
                userAssetId: position(userId, "bitcoin"),
                quantity: "0.1",
              },
            }),
            now,
          );
          await assert.rejects(
            client.portfolioEvent.update({
              where: { id: event.id },
              data: { note: "rewrite history" },
            }),
            /immutable/i,
          );
          const movement = await client.assetMovement.findFirst({
            where: { portfolioEventId: event.id },
          });
          await assert.rejects(
            client.assetMovement.delete({ where: { id: movement.id } }),
            /immutable/i,
          );
        },
      );
    } finally {
      if (client) await client.$disconnect();
      await admin.$executeRawUnsafe(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
      );
      await admin.$disconnect();
    }
  });
}
