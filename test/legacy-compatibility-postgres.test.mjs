import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { readLedgerAdoption } from "../src/services/portfolio-transactions/adoption.ts";
import { persistSessionUser } from "../src/services/prisma/session-user.ts";
import {
  readPortfolioHome,
  findOwnedAssetForRead,
  listOwnedAssetHistoryForRead,
} from "../src/services/asset/cutover-queries.ts";
import {
  createOwnedAsset,
  updateOwnedAsset,
  renameOwnedAsset,
  deleteOwnedAsset,
} from "../src/services/asset/mutations.ts";
import { listOwnedTransactionPositions } from "../src/services/portfolio-transactions/queries.ts";
import {
  readOwnedInsights,
  listOwnedScenarios,
} from "../src/services/portfolio-insights/store.ts";

const configuredUrl = process.env.CRYPTFOLIO_LEDGER_TEST_DATABASE_URL;
const required = process.env.CRYPTFOLIO_REQUIRE_LEDGER_TEST_DATABASE === "1";

if (!configuredUrl) {
  test(
    "legacy compatibility requires an explicit disposable database",
    { skip: !required },
    () => {
      assert.fail(
        "Set CRYPTFOLIO_LEDGER_TEST_DATABASE_URL to a loopback cryptfolio test database.",
      );
    },
  );
} else {
  test("the deployed client supports the original database before ledger migration", async (t) => {
    const url = new URL(configuredUrl);
    assert.match(url.protocol, /^postgres(?:ql)?:$/);
    assert.ok(
      ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname),
    );
    assert.match(decodeURIComponent(url.pathname), /cryptfolio.*test/i);
    const schema = `cryptfolio_legacy_test_${process.pid}_${randomBytes(4).toString("hex")}`;
    url.searchParams.delete("options");
    url.searchParams.set("schema", schema);
    const client = new PrismaClient({
      datasources: { db: { url: url.toString() } },
    });
    const owner = "auth0|legacy-owner";
    const foreign = "auth0|other-owner";
    const markets = async () => ({
      markets: [],
      providerFailed: false,
      usedFallback: false,
    });
    try {
      await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      const psqlUrl = new URL(url);
      psqlUrl.searchParams.delete("schema");
      psqlUrl.searchParams.set("options", `-csearch_path=${schema}`);
      const baseline = spawnSync(
        "psql",
        [
          psqlUrl.toString(),
          "-v",
          "ON_ERROR_STOP=1",
          "-f",
          "prisma/migrations/20260820120000_legacy_baseline/migration.sql",
        ],
        { encoding: "utf8" },
      );
      assert.equal(baseline.status, 0, baseline.stderr);

      await t.test(
        "session persistence inserts and updates only legacy columns",
        async () => {
          await persistSessionUser(client, {
            id: owner,
            name: "Original",
            email: "owner@example.test",
          });
          await persistSessionUser(client, {
            id: owner,
            name: "Updated",
            email: "owner@example.test",
          });
          await persistSessionUser(client, {
            id: foreign,
            name: "Other",
            email: "other@example.test",
          });
          assert.equal(
            (
              await client.user.findUnique({
                where: { id: owner },
                select: { name: true },
              })
            ).name,
            "Updated",
          );
          // Reproduce the exact production failure against this schema.
          await assert.rejects(
            client.user.findUnique({
              where: { id: owner },
              select: { ledgerAdoptedAt: true },
            }),
            { code: "P2022" },
          );
          assert.equal(await readLedgerAdoption(client, owner), null);
        },
      );

      let asset;
      await t.test(
        "Home and asset detail preserve legacy holdings and owner isolation",
        async () => {
          asset = await createOwnedAsset(client, {
            userId: owner,
            assetId: "bitcoin",
            assetName: "Wallet",
            amount: 1.25,
          });
          await createOwnedAsset(client, {
            userId: foreign,
            assetId: "bitcoin",
            assetName: "Other wallet",
            amount: 99,
          });
          const home = await readPortfolioHome(client, owner, {
            page: 1,
            pageSize: 50,
          });
          assert.equal(home.assetsPage.ledgerAdopted, false);
          assert.equal(home.assetsPage.total, 1);
          assert.deepEqual(home.holdings, [
            { assetId: "bitcoin", amount: "1.25" },
          ]);
          assert.equal(
            (await findOwnedAssetForRead(client, owner, asset.id)).amount,
            "1.25",
          );
          assert.equal(
            await findOwnedAssetForRead(client, foreign, asset.id),
            null,
          );
        },
      );

      await t.test(
        "legacy edits, archives, and deletes remain guarded",
        async () => {
          await assert.rejects(
            updateOwnedAsset(client, {
              id: asset.id,
              userId: foreign,
              expectedDate: asset.date,
              assetName: "Stolen",
              amount: 9,
            }),
          );
          const updated = await updateOwnedAsset(client, {
            id: asset.id,
            userId: owner,
            expectedDate: asset.date,
            assetName: "Updated wallet",
            amount: 2.5,
          });
          await assert.rejects(
            updateOwnedAsset(client, {
              id: asset.id,
              userId: owner,
              expectedDate: asset.date,
              assetName: "Stale edit",
              amount: 4,
            }),
            { code: "STALE_VERSION" },
          );
          const history = await listOwnedAssetHistoryForRead(
            client,
            owner,
            asset.id,
            10,
            1,
          );
          assert.equal(history.length, 1);
          assert.equal(history[0].amount, "1.25");
          assert.deepEqual(
            await listOwnedAssetHistoryForRead(
              client,
              foreign,
              asset.id,
              10,
              1,
            ),
            [],
          );
          assert.equal(
            (
              await renameOwnedAsset(client, {
                id: asset.id,
                userId: owner,
                assetName: "Renamed",
              })
            ).amount,
            updated.amount,
          );
          await assert.rejects(deleteOwnedAsset(client, asset.id, foreign));
          await deleteOwnedAsset(client, asset.id, owner);
          assert.equal(
            await findOwnedAssetForRead(client, owner, asset.id),
            null,
          );
        },
      );

      await t.test(
        "new feature reads stop before accessing missing tables",
        async () => {
          assert.deepEqual(await listOwnedTransactionPositions(client, owner), {
            ledgerAdopted: false,
            positions: [],
          });
          const insights = await readOwnedInsights(client, owner, markets);
          assert.equal(insights.ledgerAdopted, false);
          assert.deepEqual(insights.targets, []);
          assert.deepEqual(insights.tremors, []);
          assert.deepEqual(await listOwnedScenarios(client, owner), []);
        },
      );

      await t.test(
        "adoption is detected without restart and broken ledgers never use legacy balances",
        async () => {
          await client.$executeRawUnsafe(
            `ALTER TABLE "User" ADD COLUMN "ledgerAdoptedAt" TIMESTAMP(3)`,
          );
          const adoptedAt = new Date("2026-09-06T12:00:00.000Z");
          await client.user.update({
            where: { id: owner },
            data: { ledgerAdoptedAt: adoptedAt },
            select: { id: true },
          });
          await persistSessionUser(client, {
            id: owner,
            name: "Signed in after adoption",
            email: "owner@example.test",
          });
          assert.equal(
            (await readLedgerAdoption(client, owner)).toISOString(),
            adoptedAt.toISOString(),
          );
          await assert.rejects(
            readPortfolioHome(client, owner, { page: 1, pageSize: 50 }),
            { code: "P2021" },
          );
          await assert.rejects(
            createOwnedAsset(client, {
              userId: owner,
              assetId: "bitcoin",
              assetName: "Cannot bypass ledger",
              amount: 9,
            }),
            { code: "LEDGER_REQUIRED" },
          );
        },
      );
    } finally {
      await client.$executeRawUnsafe(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
      );
      await client.$disconnect();
    }
  });
}
