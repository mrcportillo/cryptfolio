import { createHash, timingSafeEqual } from "node:crypto";
export {
  isPortfolioSnapshotCronPath,
  PORTFOLIO_SNAPSHOT_CRON_PATH,
} from "./cron-path.ts";

export type CronAuthorizationResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function authorizeCronRequest(
  authorization: string | null,
  configuredSecret: string | undefined = process.env.CRON_SECRET,
): CronAuthorizationResult {
  if (!configuredSecret) {
    return {
      ok: false,
      status: 503,
      error: "Snapshot scheduling is not configured.",
    };
  }
  if (!authorization) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const expected = digest(`Bearer ${configuredSecret}`);
  const actual = digest(authorization);
  return timingSafeEqual(actual, expected)
    ? { ok: true }
    : { ok: false, status: 401, error: "Unauthorized" };
}
