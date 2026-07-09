import assert from "node:assert/strict";
import test from "node:test";
import {
  getRequestIdentifier,
  rateLimit,
} from "../src/lib/rate-limit.ts";

test("rate limits requests per authenticated user", () => {
  const key = `test-user-${Date.now()}-${Math.random()}`;

  assert.equal(rateLimit(key, 2, 60_000).allowed, true);
  assert.equal(rateLimit(key, 2, 60_000).allowed, true);
  const blocked = rateLimit(key, 2, 60_000);

  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
});

test("rate-limit identifiers do not trust spoofable forwarding headers", () => {
  const request = new Request("http://localhost", {
    headers: { "x-forwarded-for": "198.51.100.10" },
  });

  assert.equal(getRequestIdentifier(request, "auth0|user-123"), "auth0|user-123");
});
