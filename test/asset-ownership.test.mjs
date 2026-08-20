import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteOwnedAsset,
  updateOwnedAsset,
} from "../src/services/asset/mutations.ts";

function cloneState(state) {
  return {
    assets: new Map([...state.assets].map(([id, asset]) => [id, { ...asset }])),
    archives: state.archives.map((archive) => ({ ...archive })),
  };
}

function createMutationClient(initialAssets) {
  const state = {
    assets: new Map(initialAssets.map((asset) => [asset.id, { ...asset }])),
    archives: [],
  };
  const calls = {
    updates: [],
    deletes: [],
  };

  function operations(targetState) {
    return {
      userAsset: {
        async update(args) {
          calls.updates.push(args);
          const asset = targetState.assets.get(args.where.id);

          if (
            !asset ||
            asset.userId !== args.where.userId ||
            asset.date.getTime() !== args.where.date.getTime()
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
    };
  }

  return {
    state,
    calls,
    client: {
      async $transaction(operation) {
        const transactionState = cloneState(state);
        const result = await operation(operations(transactionState));

        state.assets = transactionState.assets;
        state.archives = transactionState.archives;
        return result;
      },
      userAsset: operations(state).userAsset,
    },
  };
}

const victimAsset = {
  id: "asset-victim",
  userId: "auth0|victim",
  assetName: "Victim BTC",
  amount: 1,
  date: new Date("2026-08-19T12:00:00.000Z"),
};

test("an owner-scoped update changes the asset and archives its previous value", async () => {
  const { client, state, calls } = createMutationClient([victimAsset]);

  await updateOwnedAsset(client, {
    id: victimAsset.id,
    userId: victimAsset.userId,
    previousAmount: victimAsset.amount,
    previousDate: victimAsset.date,
    assetName: "Updated BTC",
    amount: 2,
  });

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

test("a different user cannot update an asset or create archive history", async () => {
  const { client, state, calls } = createMutationClient([victimAsset]);

  await assert.rejects(
    updateOwnedAsset(client, {
      id: victimAsset.id,
      userId: "auth0|attacker",
      previousAmount: victimAsset.amount,
      previousDate: victimAsset.date,
      assetName: "Stolen BTC",
      amount: 99,
    }),
    /Record not found/,
  );

  assert.deepEqual(calls.updates[0].where, {
    id: victimAsset.id,
    userId: "auth0|attacker",
    date: victimAsset.date,
  });
  assert.deepEqual(state.assets.get(victimAsset.id), victimAsset);
  assert.deepEqual(state.archives, []);
});

test("a different user cannot delete an asset", async () => {
  const { client, state, calls } = createMutationClient([victimAsset]);

  await assert.rejects(
    deleteOwnedAsset(client, victimAsset.id, "auth0|attacker"),
    /Record not found/,
  );

  assert.deepEqual(calls.deletes[0].where, {
    id: victimAsset.id,
    userId: "auth0|attacker",
  });
  assert.deepEqual(state.assets.get(victimAsset.id), victimAsset);
});

test("only one update from the same prior snapshot commits", async () => {
  const { client, state, calls } = createMutationClient([victimAsset]);
  const firstUpdate = {
    id: victimAsset.id,
    userId: victimAsset.userId,
    previousAmount: victimAsset.amount,
    previousDate: victimAsset.date,
    assetName: "First update",
    amount: 2,
  };

  await updateOwnedAsset(client, firstUpdate);
  await assert.rejects(
    updateOwnedAsset(client, {
      ...firstUpdate,
      assetName: "Stale update",
      amount: 3,
    }),
    /Record not found/,
  );

  assert.deepEqual(
    calls.updates.map(({ where }) => where),
    [
      {
        id: victimAsset.id,
        userId: victimAsset.userId,
        date: victimAsset.date,
      },
      {
        id: victimAsset.id,
        userId: victimAsset.userId,
        date: victimAsset.date,
      },
    ],
  );
  assert.equal(state.assets.get(victimAsset.id).assetName, "First update");
  assert.equal(state.assets.get(victimAsset.id).amount, 2);
  assert.equal(state.archives.length, 1);
  assert.deepEqual(state.archives[0], {
    userAssetId: victimAsset.id,
    amount: victimAsset.amount,
    date: victimAsset.date,
  });
});
