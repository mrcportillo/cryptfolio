import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Check what Next will deploy: the Auth0 callback persists users with Prisma,
// which cannot execute in Edge middleware. Source-only checks miss build drift.
const manifest = JSON.parse(
  await readFile(".next/server/functions-config-manifest.json", "utf8"),
);
const middleware = manifest.functions["/_middleware"];
assert.equal(
  middleware?.runtime,
  "nodejs",
  "Auth0 session persistence requires Node middleware in the production build",
);

const matchers = middleware.matchers.map(({ regexp }) => new RegExp(regexp));
const matches = (pathname) =>
  matchers.some((matcher) => matcher.test(pathname));

for (const pathname of [
  "/home",
  "/trend",
  "/transactions",
  "/transactions/new",
  "/transactions/example",
  "/reports/weekly",
  "/scenarios",
  "/assets/example",
  "/api/auth/login",
  "/api/auth/callback",
  "/api/auth/profile",
  "/api/asset/example/archive",
  "/api/coin/list",
  "/api/cron/portfolio-snapshots",
  "/images/logo.png/private",
  "/images/logoXpng",
  "/images/private.png",
]) {
  assert.ok(matches(pathname), `Middleware must handle ${pathname}`);
}

assert.equal(
  matches("/images/logo.png"),
  false,
  "The public logo must load without a session",
);
console.log(
  "Built middleware uses Node.js; authentication routes and public logo matchers verified.",
);
