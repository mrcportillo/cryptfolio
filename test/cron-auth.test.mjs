import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeCronRequest,
  isPortfolioSnapshotCronPath,
  PORTFOLIO_SNAPSHOT_CRON_PATH,
} from "../src/lib/cron-auth.ts";

test("cron authorization fails closed when configuration is absent", () => {
  assert.deepEqual(authorizeCronRequest("Bearer anything", undefined), {
    ok: false,
    status: 503,
    error: "Snapshot scheduling is not configured.",
  });
});

test("cron authorization requires the exact dedicated bearer secret", () => {
  assert.deepEqual(authorizeCronRequest(null, "dedicated-secret"), {
    ok: false,
    status: 401,
    error: "Unauthorized",
  });
  assert.deepEqual(
    authorizeCronRequest("Bearer browser-session", "dedicated-secret"),
    { ok: false, status: 401, error: "Unauthorized" },
  );
  assert.deepEqual(
    authorizeCronRequest("Bearer dedicated-secret", "dedicated-secret"),
    { ok: true },
  );
});

test("only the exact portfolio snapshot path bypasses browser-session middleware", () => {
  assert.equal(PORTFOLIO_SNAPSHOT_CRON_PATH, "/api/cron/portfolio-snapshots");
  assert.equal(isPortfolioSnapshotCronPath(PORTFOLIO_SNAPSHOT_CRON_PATH), true);
  assert.equal(
    isPortfolioSnapshotCronPath(`${PORTFOLIO_SNAPSHOT_CRON_PATH}/`),
    false,
  );
  assert.equal(isPortfolioSnapshotCronPath("/api/cron/other"), false);
  assert.equal(isPortfolioSnapshotCronPath("/api/portfolio/snapshots"), false);
});
