import assert from "node:assert/strict";
import test from "node:test";

import { createPortfolioSnapshotCronHandler } from "../src/services/portfolio-valuation/cron-handler.ts";

const now = new Date("2026-08-29T03:10:00.000Z");

test("cron handler rejects browser sessions and invalid secrets before work", async () => {
  let calls = 0;
  const handler = createPortfolioSnapshotCronHandler({
    configuredSecret: "dedicated-secret",
    now: () => now,
    run: async () => {
      calls += 1;
      throw new Error("must not run");
    },
    logError: () => {},
  });

  const browser = await handler(
    new Request("http://localhost/api/cron/portfolio-snapshots", {
      headers: {
        cookie: "appSession=browser",
        authorization: "Bearer browser",
      },
    }),
  );
  assert.equal(browser.status, 401);
  assert.equal(calls, 0);
});

test("cron handler runs with dedicated auth and returns bounded summary", async () => {
  let receivedNow;
  const expected = {
    usersProcessed: 1,
    snapshotsCreated: 2,
    snapshotsIncomplete: 0,
    snapshotsSkipped: 1,
  };
  const handler = createPortfolioSnapshotCronHandler({
    configuredSecret: "dedicated-secret",
    now: () => now,
    run: async (value) => {
      receivedNow = value;
      return expected;
    },
    logError: () => {},
  });

  const response = await handler(
    new Request("http://localhost/api/cron/portfolio-snapshots", {
      headers: { authorization: "Bearer dedicated-secret" },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(receivedNow.toISOString(), now.toISOString());
  assert.deepEqual(await response.json(), expected);
});

test("cron handler logs provider failures without exposing details in response", async () => {
  const logged = [];
  const handler = createPortfolioSnapshotCronHandler({
    configuredSecret: "dedicated-secret",
    run: async () => {
      throw new Error("provider detail");
    },
    logError: (error) => logged.push(error),
  });
  const response = await handler(
    new Request("http://localhost/api/cron/portfolio-snapshots", {
      headers: { authorization: "Bearer dedicated-secret" },
    }),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Daily portfolio valuation failed.",
  });
  assert.equal(logged.length, 1);
});
