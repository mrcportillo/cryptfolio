import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  deleteOwnedAsset,
  renameOwnedAsset,
  updateOwnedAsset,
} from "../src/services/asset/mutations.ts";

function cloneState(state) {
  return {
    users: new Map([...state.users].map(([id, user]) => [id, { ...user }])),
    assets: new Map([...state.assets].map(([id, asset]) => [id, { ...asset }])),
    archives: state.archives.map((archive) => ({ ...archive })),
    movements: state.movements.map((movement) => ({ ...movement })),
  };
}

function createMutationClient(initialAssets, { adopted = false } = {}) {
  const state = {
    users: new Map([
      [
        "auth0|victim",
        {
          id: "auth0|victim",
          ledgerAdoptedAt: adopted
            ? new Date("2026-08-20T12:00:00.000Z")
            : null,
        },
      ],
      ["auth0|attacker", { id: "auth0|attacker", ledgerAdoptedAt: null }],
    ]),
    assets: new Map(initialAssets.map((asset) => [asset.id, { ...asset }])),
    archives: [],
    movements: [],
  };
  const calls = {
    locks: [],
    updates: [],
    deletes: [],
  };

  function operations(targetState) {
    return {
      async $queryRawUnsafe(_sql, lockKey) {
        calls.locks.push(lockKey);
        return [{ locked: 1 }];
      },
      async $queryRaw(_strings, userId) {
        const user = targetState.users.get(userId);
        return user ? [user] : [];
      },
      userAsset: {
        async findFirst(args) {
          const asset = targetState.assets.get(args.where.id);
          return asset?.userId === args.where.userId ? asset : null;
        },
        async update(args) {
          calls.updates.push(args);
          const asset = targetState.assets.get(args.where.id);
          if (
            !asset ||
            asset.userId !== args.where.userId ||
            (args.where.date &&
              asset.date.getTime() !== args.where.date.getTime())
          ) {
            throw new Error("Record not found");
          }
          targetState.assets.set(asset.id, { ...asset, ...args.data });
          return targetState.assets.get(asset.id);
        },
        async delete(args) {
          calls.deletes.push(args);
          const asset = targetState.assets.get(args.where.id);
          if (!asset || asset.userId !== args.where.userId) {
            throw new Error("Record not found");
          }
          targetState.assets.delete(asset.id);
          return asset;
        },
      },
      assetArchive: {
        async create(args) {
          targetState.archives.push({ ...args.data });
          return args.data;
        },
      },
      assetMovement: {
        async aggregate(args) {
          const quantity = targetState.movements
            .filter(
              (movement) =>
                movement.userId === args.where.userId &&
                movement.userAssetId === args.where.userAssetId,
            )
            .reduce((sum, movement) => sum + movement.quantityDelta, 0);
          return {
            _sum: { quantityDelta: new Prisma.Decimal(String(quantity)) },
          };
        },
      },
    };
  }

  return {
    state,
    calls,
    client: {
      async $transaction(operation) {
        const transactionState = cloneState(state);
        const result = await operation(operations(transactionState));
        state.users = transactionState.users;
        state.assets = transactionState.assets;
        state.archives = transactionState.archives;
        state.movements = transactionState.movements;
        return result;
      },
    },
  };
}

const victimAsset = {
  id: "asset-victim",
  userId: "auth0|victim",
  assetName: "Victim BTC",
  amount: 1,
  date: new Date("2026-08-19T12:00:00.000Z"),
  archivedAt: null,
};

test("a pre-adoption owner update locks, changes, and archives", async () => {
  const { client, state, calls } = createMutationClient([victimAsset]);

  await updateOwnedAsset(client, {
    id: victimAsset.id,
    userId: victimAsset.userId,
    expectedDate: victimAsset.date,
    assetName: "Updated BTC",
    amount: 2,
  });

  assert.equal(calls.locks[0], "cryptfolio:opening-balances:auth0|victim");
  assert.deepEqual(calls.updates[0].where, {
    id: victimAsset.id,
    userId: victimAsset.userId,
    date: victimAsset.date,
  });
  assert.equal(state.assets.get(victimAsset.id).amount, 2);
  assert.deepEqual(state.archives, [
    {
      userAssetId: victimAsset.id,
      amount: victimAsset.amount,
      date: victimAsset.date,
    },
  ]);
});

test("a different user cannot update or delete another position", async () => {
  const { client, state } = createMutationClient([victimAsset]);
  await assert.rejects(
    updateOwnedAsset(client, {
      id: victimAsset.id,
      userId: "auth0|attacker",
      expectedDate: victimAsset.date,
      assetName: "Stolen BTC",
      amount: 99,
    }),
    /Asset not found/,
  );
  await assert.rejects(
    deleteOwnedAsset(client, victimAsset.id, "auth0|attacker"),
    /Asset not found/,
  );
  assert.deepEqual(state.assets.get(victimAsset.id), victimAsset);
  assert.deepEqual(state.archives, []);
});

test("adopted quantity edits reject without touching Float or archives", async () => {
  const { client, state } = createMutationClient([victimAsset], {
    adopted: true,
  });
  await assert.rejects(
    updateOwnedAsset(client, {
      id: victimAsset.id,
      userId: victimAsset.userId,
      expectedDate: victimAsset.date,
      assetName: "Changed",
      amount: 2,
    }),
    (error) => error.code === "LEDGER_AMOUNT_FROZEN",
  );
  assert.deepEqual(state.assets.get(victimAsset.id), victimAsset);
  assert.deepEqual(state.archives, []);
});

test("an adopted owner can still rename an alias without touching balance state", async () => {
  const { client, state, calls } = createMutationClient([victimAsset], {
    adopted: true,
  });

  await renameOwnedAsset(client, {
    id: victimAsset.id,
    userId: victimAsset.userId,
    assetName: "Cold wallet",
  });

  assert.equal(state.assets.get(victimAsset.id).assetName, "Cold wallet");
  assert.equal(state.assets.get(victimAsset.id).amount, victimAsset.amount);
  assert.equal(state.assets.get(victimAsset.id).date, victimAsset.date);
  assert.equal(state.archives.length, 0);
  assert.equal(calls.locks[0], "cryptfolio:opening-balances:auth0|victim");
});

test("a stale pre-adoption edit cannot overwrite a newer edit", async () => {
  const { client, state } = createMutationClient([victimAsset]);
  const staleVersion = victimAsset.date;

  await updateOwnedAsset(client, {
    id: victimAsset.id,
    userId: victimAsset.userId,
    expectedDate: staleVersion,
    assetName: "First update",
    amount: 2,
  });
  await assert.rejects(
    updateOwnedAsset(client, {
      id: victimAsset.id,
      userId: victimAsset.userId,
      expectedDate: staleVersion,
      assetName: "Stale update",
      amount: 3,
    }),
    (error) => error.code === "STALE_VERSION" && /Reload/.test(error.message),
  );

  assert.equal(state.assets.get(victimAsset.id).assetName, "First update");
  assert.equal(state.assets.get(victimAsset.id).amount, 2);
  assert.equal(state.archives.length, 1);
});

test("adopted positions archive only at exact zero and are never deleted", async () => {
  const nonzero = createMutationClient([victimAsset], { adopted: true });
  nonzero.state.movements.push({
    userId: victimAsset.userId,
    userAssetId: victimAsset.id,
    quantityDelta: 1,
  });
  await assert.rejects(
    deleteOwnedAsset(nonzero.client, victimAsset.id, victimAsset.userId),
    (error) => error.code === "NONZERO_POSITION",
  );
  assert.ok(nonzero.state.assets.has(victimAsset.id));

  const zero = createMutationClient([victimAsset], { adopted: true });
  zero.state.movements.push(
    {
      userId: victimAsset.userId,
      userAssetId: victimAsset.id,
      quantityDelta: 1,
    },
    {
      userId: victimAsset.userId,
      userAssetId: victimAsset.id,
      quantityDelta: -1,
    },
  );
  await deleteOwnedAsset(zero.client, victimAsset.id, victimAsset.userId);
  assert.ok(zero.state.assets.get(victimAsset.id).archivedAt);
  assert.equal(zero.calls.deletes.length, 0);

  const neverFunded = createMutationClient([victimAsset], { adopted: true });
  await deleteOwnedAsset(
    neverFunded.client,
    victimAsset.id,
    victimAsset.userId,
  );
  assert.ok(neverFunded.state.assets.get(victimAsset.id).archivedAt);
  assert.equal(neverFunded.calls.deletes.length, 0);
});
