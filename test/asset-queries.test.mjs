import assert from "node:assert/strict";
import test from "node:test";
import {
  findOwnedAssetArchives,
  findOwnedAssetById,
} from "../src/services/asset/queries.ts";

function createQueryClient(assets, archives) {
  const calls = {
    assets: [],
    archives: [],
  };

  return {
    calls,
    client: {
      userAsset: {
        async findFirst(args) {
          calls.assets.push(args);
          return (
            assets.find(
              (asset) =>
                asset.id === args.where.id &&
                asset.userId === args.where.userId,
            ) ?? null
          );
        },
      },
      assetArchive: {
        async findMany(args) {
          calls.archives.push(args);
          const asset = assets.find(
            ({ id, userId }) =>
              id === args.where.userAssetId &&
              userId === args.where.userAsset.userId,
          );

          if (!asset) {
            return [];
          }

          return archives
            .filter(({ userAssetId }) => userAssetId === asset.id)
            .sort((left, right) => left.date.getTime() - right.date.getTime())
            .slice(args.skip, args.skip + args.take);
        },
      },
    },
  };
}

const victimAsset = {
  id: "asset-victim",
  userId: "auth0|victim",
  assetId: "bitcoin",
  assetName: "Victim BTC",
  amount: 1,
  date: new Date("2026-08-19T12:00:00.000Z"),
};

const victimArchives = [
  {
    id: "archive-newest",
    userAssetId: victimAsset.id,
    amount: 3,
    date: new Date("2026-08-19T11:00:00.000Z"),
  },
  {
    id: "archive-oldest",
    userAssetId: victimAsset.id,
    amount: 1,
    date: new Date("2026-08-19T09:00:00.000Z"),
  },
  {
    id: "archive-middle",
    userAssetId: victimAsset.id,
    amount: 2,
    date: new Date("2026-08-19T10:00:00.000Z"),
  },
];

test("a different user cannot retrieve an asset or its archives", async () => {
  const { client, calls } = createQueryClient([victimAsset], victimArchives);
  const attackerId = "auth0|attacker";

  const asset = await findOwnedAssetById(client, victimAsset.id, attackerId);
  const archives = await findOwnedAssetArchives(
    client,
    attackerId,
    victimAsset.id,
    2,
    1,
  );

  assert.equal(asset, null);
  assert.deepEqual(archives, []);
  assert.deepEqual(calls.assets[0], {
    where: {
      id: victimAsset.id,
      userId: attackerId,
    },
  });
  assert.deepEqual(calls.archives[0], {
    where: {
      userAssetId: victimAsset.id,
      userAsset: { userId: attackerId },
    },
    orderBy: { date: "asc" },
    take: 2,
    skip: 0,
  });
});

test("archive reads preserve ascending order and pagination", async () => {
  const { client, calls } = createQueryClient([victimAsset], victimArchives);

  const archives = await findOwnedAssetArchives(
    client,
    victimAsset.userId,
    victimAsset.id,
    2,
    2,
  );

  assert.deepEqual(
    archives.map(({ id }) => id),
    ["archive-newest"],
  );
  assert.deepEqual(calls.archives[0], {
    where: {
      userAssetId: victimAsset.id,
      userAsset: { userId: victimAsset.userId },
    },
    orderBy: { date: "asc" },
    take: 2,
    skip: 2,
  });
});
