#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  openingBalanceHelp,
  parseOpeningBalanceArguments,
  runOpeningBalanceConversion,
} from "./opening-balances-lib.mjs";

const UTC_TIMESTAMP_SQL = `to_char(%s, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const MAX_SERIALIZABLE_ATTEMPTS = 3;

function isSerializationFailure(error) {
  return (
    error?.code === "P2034" ||
    (error?.code === "P2010" && ["40001", "40P01"].includes(error?.meta?.code))
  );
}

function userSelectionSql({ lock = false } = {}) {
  return `
    SELECT
      "id",
      CASE
        WHEN "ledgerAdoptedAt" IS NULL THEN NULL
        ELSE ${UTC_TIMESTAMP_SQL.replace("%s", '"ledgerAdoptedAt"')}
      END AS "ledgerAdoptedAt"
    FROM "User"
    WHERE "id" = $1
    ${lock ? "FOR UPDATE" : ""}
  `;
}

function legacyPositionsSql({ lock = false } = {}) {
  return `
    SELECT
      "id",
      "userId",
      "assetId",
      "assetName",
      "amount"::text AS "amountText",
      ${UTC_TIMESTAMP_SQL.replace("%s", '"date"')} AS "dateText"
    FROM "UserAsset"
    WHERE "userId" = $1
    ORDER BY "id"
    ${lock ? "FOR UPDATE" : ""}
  `;
}

export function createPostgresOpeningBalanceStore(client) {
  return {
    async runSerializable(operation) {
      for (
        let attempt = 1;
        attempt <= MAX_SERIALIZABLE_ATTEMPTS;
        attempt += 1
      ) {
        try {
          return await client.$transaction(
            (transaction) => operation(transaction),
            {
              isolationLevel: "Serializable",
              maxWait: 10_000,
              timeout: 120_000,
            },
          );
        } catch (error) {
          if (
            !isSerializationFailure(error) ||
            attempt === MAX_SERIALIZABLE_ATTEMPTS
          ) {
            throw error;
          }
        }
      }

      throw new Error("Serializable transaction retry loop exhausted.");
    },

    async getUser(transaction, userId) {
      const users = await transaction.$queryRawUnsafe(
        userSelectionSql(),
        userId,
      );
      return users[0] ?? null;
    },

    async lockUser(transaction, userId) {
      await transaction.$queryRawUnsafe(
        `
          SELECT 1::integer AS "locked"
          FROM pg_advisory_xact_lock(hashtextextended($1::text, 0))
        `,
        `cryptfolio:opening-balances:${userId}`,
      );
      const users = await transaction.$queryRawUnsafe(
        userSelectionSql({ lock: true }),
        userId,
      );
      return users[0] ?? null;
    },

    getLegacyPositions(transaction, userId, { lock }) {
      return transaction.$queryRawUnsafe(legacyPositionsSql({ lock }), userId);
    },

    async createOpening(transaction, { userId, adoptionAt, position }) {
      const candidateEventId = randomUUID();
      await transaction.$executeRawUnsafe(
        `
          INSERT INTO "PortfolioEvent" (
            "id",
            "userId",
            "kind",
            "occurredAt",
            "externalFlowUsd",
            "feeUsd",
            "idempotencyKey",
            "openingForUserAssetId"
          )
          VALUES (
            $1,
            $2,
            'OPENING_BALANCE',
            $3::timestamptz AT TIME ZONE 'UTC',
            0,
            0,
            $4,
            $5
          )
          ON CONFLICT ("userId", "idempotencyKey") DO NOTHING
        `,
        candidateEventId,
        userId,
        adoptionAt,
        position.idempotencyKey,
        position.id,
      );

      const events = await transaction.$queryRawUnsafe(
        `
          SELECT "id"
          FROM "PortfolioEvent"
          WHERE "userId" = $1
            AND "idempotencyKey" = $2
        `,
        userId,
        position.idempotencyKey,
      );
      const event = events[0];

      if (!event) {
        throw new Error(`Could not create opening event for ${position.id}.`);
      }

      await transaction.$executeRawUnsafe(
        `
          INSERT INTO "AssetMovement" (
            "id",
            "userId",
            "portfolioEventId",
            "userAssetId",
            "quantityDelta",
            "unitPriceUsd",
            "priceEstimated"
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5::numeric(65,30),
            NULL,
            false
          )
          ON CONFLICT ("id") DO NOTHING
        `,
        `opening-movement:${event.id}`,
        userId,
        event.id,
        position.id,
        position.quantity,
      );
    },

    async flushOpeningConstraints(transaction) {
      await transaction.$executeRawUnsafe(
        `
          SET CONSTRAINTS
            "PortfolioEvent_exactly_one_opening_movement_check",
            "AssetMovement_exactly_one_opening_movement_check"
          IMMEDIATE
        `,
      );
    },

    getOpeningRecords(transaction, userId) {
      return transaction.$queryRawUnsafe(
        `
          SELECT
            event."id" AS "eventId",
            event."userId" AS "eventUserId",
            event."kind"::text AS "kind",
            ${UTC_TIMESTAMP_SQL.replace("%s", 'event."occurredAt"')} AS "occurredAtText",
            event."externalFlowUsd"::text AS "externalFlowUsdText",
            event."feeUsd"::text AS "feeUsdText",
            event."idempotencyKey" AS "idempotencyKey",
            event."openingForUserAssetId" AS "openingForUserAssetId",
            movement."id" AS "movementId",
            movement."userId" AS "movementUserId",
            movement."userAssetId" AS "movementUserAssetId",
            movement."quantityDelta"::text AS "quantityDeltaText",
            movement."unitPriceUsd"::text AS "unitPriceUsdText",
            movement."priceEstimated" AS "priceEstimated"
          FROM "PortfolioEvent" AS event
          LEFT JOIN "AssetMovement" AS movement
            ON movement."portfolioEventId" = event."id"
           AND movement."userId" = event."userId"
          WHERE event."userId" = $1
            AND event."kind" = 'OPENING_BALANCE'
          ORDER BY event."openingForUserAssetId", event."id", movement."id"
        `,
        userId,
      );
    },

    getDerivedQuantities(transaction, userId) {
      return transaction.$queryRawUnsafe(
        `
          SELECT
            position."id" AS "userAssetId",
            position."userId" AS "userId",
            coalesce(sum(movement."quantityDelta"), 0)::text AS "quantityText"
          FROM "UserAsset" AS position
          LEFT JOIN "AssetMovement" AS movement
            ON movement."userAssetId" = position."id"
           AND movement."userId" = position."userId"
          WHERE position."userId" = $1
          GROUP BY position."id", position."userId"
          ORDER BY position."id"
        `,
        userId,
      );
    },

    async markLedgerAdopted(transaction, userId, adoptionAt) {
      const users = await transaction.$queryRawUnsafe(
        `
          UPDATE "User"
          SET "ledgerAdoptedAt" = $2::timestamptz AT TIME ZONE 'UTC'
          WHERE "id" = $1
            AND "ledgerAdoptedAt" IS NULL
          RETURNING
            "id",
            ${UTC_TIMESTAMP_SQL.replace("%s", '"ledgerAdoptedAt"')} AS "ledgerAdoptedAt"
        `,
        userId,
        adoptionAt,
      );
      return users[0] ?? null;
    },
  };
}

export async function runCli(
  argv = process.argv.slice(2),
  environment = process.env,
) {
  const options = parseOpeningBalanceArguments(argv);

  if (options.help) {
    console.log(openingBalanceHelp());
    return;
  }

  if (!environment.POSTGRES_URL_NON_POOLING) {
    throw new Error(
      "POSTGRES_URL_NON_POOLING must be set explicitly; the cutover will not use a pooled connection.",
    );
  }

  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({
    datasources: {
      db: { url: environment.POSTGRES_URL_NON_POOLING },
    },
  });

  try {
    const result = await runOpeningBalanceConversion({
      store: createPostgresOpeningBalanceStore(client),
      userId: options.userId,
      adoptionAt: options.adoptionAt,
      expectedFingerprint: options.expectedFingerprint,
      apply: options.apply,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.$disconnect();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
