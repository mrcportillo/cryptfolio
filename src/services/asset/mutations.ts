import type { Prisma, PrismaClient } from "@prisma/client";
import { databaseDecimalToPlain } from "../portfolio-transactions/decimal.ts";
import { legacyAssetFields } from "./fields.ts";

const USER_LOCK_NAMESPACE = "cryptfolio:opening-balances";
const MAX_SERIALIZABLE_ATTEMPTS = 3;

export class AssetCutoverError extends Error {
  readonly code:
    | "LEDGER_REQUIRED"
    | "LEDGER_AMOUNT_FROZEN"
    | "NONZERO_POSITION"
    | "STALE_VERSION";

  constructor(
    message: string,
    code:
      | "LEDGER_REQUIRED"
      | "LEDGER_AMOUNT_FROZEN"
      | "NONZERO_POSITION"
      | "STALE_VERSION",
  ) {
    super(message);
    this.name = "AssetCutoverError";
    this.code = code;
  }
}

function isSerializationFailure(error: unknown) {
  const prismaError = error as { code?: string; meta?: { code?: string } };
  return (
    prismaError.code === "P2034" ||
    (prismaError.code === "P2010" &&
      ["40001", "40P01"].includes(prismaError.meta?.code ?? ""))
  );
}

async function runSerializable<T>(
  client: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await client.$transaction(operation, {
        isolationLevel: "Serializable",
        maxWait: 10_000,
        timeout: 30_000,
      });
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
}

async function lockUser(transaction: Prisma.TransactionClient, userId: string) {
  await transaction.$queryRawUnsafe(
    `SELECT 1::integer AS "locked"
     FROM pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
    `${USER_LOCK_NAMESPACE}:${userId}`,
  );
  const users = await transaction.$queryRaw<
    Array<{ id: string; ledgerAdoptedAt: Date | null }>
  >`
    UPDATE "User"
    SET "name" = "name"
    WHERE "id" = ${userId}
    RETURNING "id", (to_jsonb("User")->>'ledgerAdoptedAt')::timestamp(3) AS "ledgerAdoptedAt"
  `;
  const user = users[0];
  if (!user) throw new Error("Portfolio owner not found.");
  return user;
}

export async function createOwnedAsset(
  client: PrismaClient,
  input: {
    userId: string;
    assetId: string;
    assetName: string;
    amount: number;
  },
) {
  return runSerializable(client, async (transaction) => {
    const user = await lockUser(transaction, input.userId);
    if (user.ledgerAdoptedAt) {
      throw new AssetCutoverError(
        "Create the position through a ledger transaction.",
        "LEDGER_REQUIRED",
      );
    }
    return transaction.userAsset.create({
      data: input,
      select: legacyAssetFields,
    });
  });
}

export async function updateOwnedAsset(
  client: PrismaClient,
  input: {
    id: string;
    userId: string;
    expectedDate: Date;
    assetName: string;
    amount: number;
  },
) {
  return runSerializable(client, async (transaction) => {
    const user = await lockUser(transaction, input.userId);
    const asset = await transaction.userAsset.findFirst({
      where: { id: input.id, userId: input.userId },
      select: legacyAssetFields,
    });
    if (!asset) throw new Error("Asset not found.");
    if (user.ledgerAdoptedAt) {
      throw new AssetCutoverError(
        "Record a transaction instead of changing the ledger quantity.",
        "LEDGER_AMOUNT_FROZEN",
      );
    }
    if (asset.date.getTime() !== input.expectedDate.getTime()) {
      throw new AssetCutoverError(
        "This asset changed since you loaded it. Reload before saving.",
        "STALE_VERSION",
      );
    }

    const updatedAt = new Date(
      Math.max(Date.now(), input.expectedDate.getTime() + 1),
    );
    const updated = await transaction.userAsset.update({
      select: legacyAssetFields,
      where: {
        id: input.id,
        userId: input.userId,
        date: input.expectedDate,
      },
      data: {
        assetName: input.assetName,
        amount: input.amount,
        date: updatedAt,
      },
    });
    await transaction.assetArchive.create({
      data: {
        userAssetId: input.id,
        amount: asset.amount,
        date: asset.date,
      },
    });
    return updated;
  });
}

export async function renameOwnedAsset(
  client: PrismaClient,
  input: { id: string; userId: string; assetName: string },
) {
  return runSerializable(client, async (transaction) => {
    await lockUser(transaction, input.userId);
    return transaction.userAsset.update({
      select: legacyAssetFields,
      where: { id: input.id, userId: input.userId },
      data: { assetName: input.assetName },
    });
  });
}

export async function deleteOwnedAsset(
  client: PrismaClient,
  id: string,
  userId: string,
) {
  return runSerializable(client, async (transaction) => {
    const user = await lockUser(transaction, userId);
    const asset = await transaction.userAsset.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!asset) throw new Error("Asset not found.");

    if (!user.ledgerAdoptedAt) {
      return transaction.userAsset.delete({
        where: { id, userId },
        select: legacyAssetFields,
      });
    }

    const balance = await transaction.assetMovement.aggregate({
      where: { userId, userAssetId: id },
      _sum: { quantityDelta: true },
    });
    if (
      (balance._sum.quantityDelta
        ? databaseDecimalToPlain(balance._sum.quantityDelta)
        : "0") !== "0"
    ) {
      throw new AssetCutoverError(
        "A position can only be archived at an exact zero balance.",
        "NONZERO_POSITION",
      );
    }
    return transaction.userAsset.update({
      where: { id, userId },
      data: { archivedAt: new Date() },
    });
  });
}
