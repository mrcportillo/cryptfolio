import assert from "node:assert/strict";
import test from "node:test";
import { createPortfolioTransactionActionHandlers } from "../src/services/portfolio-transactions/action-handlers.ts";
import { LedgerValidationError } from "../src/services/portfolio-transactions/domain.ts";

const ownerId = "auth0|owner";
const safetyKey = "123e4567-e89b-42d3-a456-426614174000";
const originalEventId = "event-original";

const recordIntent = {
  kind: "BUY",
  occurredAt: "2026-08-20T12:00:00.000Z",
  idempotencyKey: safetyKey,
  position: { mode: "existing", userAssetId: "asset-btc" },
  quantity: "1",
  actualValueUsd: "100",
  fee: null,
};

const correctionInput = {
  eventId: originalEventId,
  idempotencyKey: safetyKey,
  replacement: {
    kind: "BUY",
    occurredAt: "2026-08-20T12:00:00.000Z",
    position: { mode: "existing", userAssetId: "asset-btc" },
    quantity: "1",
    actualValueUsd: "100",
    fee: null,
  },
};

function createHarness() {
  const calls = { refreshes: [], logs: [] };
  const dependencies = {
    async requireCurrentUser() {
      return { id: ownerId };
    },
    async recordTransaction() {
      return { id: "event-recorded" };
    },
    async reverseTransaction() {
      return { id: "event-reversal" };
    },
    async correctTransaction() {
      return {
        reversal: { id: "event-correction-reversal" },
        replacement: { id: "event-correction-replacement" },
      };
    },
    async refreshPortfolio(eventIds) {
      calls.refreshes.push([...eventIds]);
    },
    logServerError(operation, error, context) {
      calls.logs.push({ operation, error, context });
    },
  };
  return {
    calls,
    dependencies,
    actions: createPortfolioTransactionActionHandlers(dependencies),
  };
}

const operationCases = [
  {
    name: "record",
    service: "recordTransaction",
    operation: "portfolio-transaction.record",
    invoke: (actions) => actions.record(recordIntent),
    successValue: { id: "event-recorded" },
    successEventIds: ["event-recorded"],
    refreshEventIds: ["event-recorded"],
    keyFromArguments: ([, intent]) => intent.idempotencyKey,
  },
  {
    name: "reverse",
    service: "reverseTransaction",
    operation: "portfolio-transaction.reverse",
    invoke: (actions) => actions.reverse(originalEventId, safetyKey),
    successValue: { id: "event-reversal" },
    successEventIds: ["event-reversal"],
    refreshEventIds: [originalEventId, "event-reversal"],
    keyFromArguments: ([, , idempotencyKey]) => idempotencyKey,
  },
  {
    name: "correct",
    service: "correctTransaction",
    operation: "portfolio-transaction.correct",
    invoke: (actions) => actions.correct(correctionInput),
    successValue: {
      reversal: { id: "event-correction-reversal" },
      replacement: { id: "event-correction-replacement" },
    },
    successEventIds: [
      "event-correction-reversal",
      "event-correction-replacement",
    ],
    refreshEventIds: [
      originalEventId,
      "event-correction-reversal",
      "event-correction-replacement",
    ],
    keyFromArguments: ([, input]) => input.idempotencyKey,
  },
];

test("known validation failures are definite action errors", async (t) => {
  for (const operationCase of operationCases) {
    await t.test(operationCase.name, async () => {
      const harness = createHarness();
      harness.dependencies[operationCase.service] = async () => {
        throw new LedgerValidationError(
          "The transaction is invalid.",
          "INVALID_INPUT",
        );
      };

      assert.deepEqual(await operationCase.invoke(harness.actions), {
        ok: false,
        error: "The transaction is invalid.",
        code: "INVALID_INPUT",
      });
      assert.deepEqual(harness.calls.refreshes, []);
      assert.deepEqual(harness.calls.logs, []);
    });
  }
});

test("unknown mutation errors reject as ambiguous after being logged", async (t) => {
  for (const operationCase of operationCases) {
    await t.test(operationCase.name, async () => {
      const harness = createHarness();
      const acknowledgementError = new Error("commit acknowledgement lost");
      harness.dependencies[operationCase.service] = async () => {
        throw acknowledgementError;
      };

      await assert.rejects(
        operationCase.invoke(harness.actions),
        (error) => error === acknowledgementError,
      );
      assert.deepEqual(harness.calls.refreshes, []);
      assert.equal(harness.calls.logs.length, 1);
      assert.equal(harness.calls.logs[0].operation, operationCase.operation);
      assert.equal(harness.calls.logs[0].error, acknowledgementError);
    });
  }
});

test("refresh failures cannot turn committed events into action failures", async (t) => {
  for (const operationCase of operationCases) {
    await t.test(operationCase.name, async () => {
      const harness = createHarness();
      const refreshError = new Error("cache refresh unavailable");
      harness.dependencies.refreshPortfolio = async (eventIds) => {
        harness.calls.refreshes.push([...eventIds]);
        throw refreshError;
      };

      assert.deepEqual(await operationCase.invoke(harness.actions), {
        ok: true,
        eventIds: operationCase.successEventIds,
      });
      assert.deepEqual(harness.calls.refreshes, [
        operationCase.refreshEventIds,
      ]);
      assert.equal(harness.calls.logs.length, 1);
      assert.equal(
        harness.calls.logs[0].operation,
        `${operationCase.operation}.refresh`,
      );
      assert.equal(harness.calls.logs[0].error, refreshError);
    });
  }
});

test("ambiguous retries preserve the caller-provided safety key", async (t) => {
  for (const operationCase of operationCases) {
    await t.test(operationCase.name, async () => {
      const harness = createHarness();
      const seenKeys = [];
      const acknowledgementError = new Error("commit acknowledgement lost");
      let attempt = 0;
      harness.dependencies[operationCase.service] = async (...args) => {
        seenKeys.push(operationCase.keyFromArguments(args));
        attempt += 1;
        if (attempt === 1) throw acknowledgementError;
        return operationCase.successValue;
      };

      await assert.rejects(
        operationCase.invoke(harness.actions),
        (error) => error === acknowledgementError,
      );
      assert.deepEqual(await operationCase.invoke(harness.actions), {
        ok: true,
        eventIds: operationCase.successEventIds,
      });
      assert.deepEqual(seenKeys, [safetyKey, safetyKey]);
    });
  }
});
