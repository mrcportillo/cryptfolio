import { authorizeCronRequest } from "../../lib/cron-auth.ts";

export type ScheduledValuationSummary = {
  usersProcessed: number;
  snapshotsCreated: number;
  snapshotsIncomplete: number;
  snapshotsSkipped: number;
};

type CronHandlerDependencies = {
  configuredSecret?: string;
  run(now: Date): Promise<ScheduledValuationSummary>;
  logError(error: unknown): void;
  now?: () => Date;
};

export function createPortfolioSnapshotCronHandler(
  dependencies: CronHandlerDependencies,
) {
  return async function GET(request: Request): Promise<Response> {
    const authorization = authorizeCronRequest(
      request.headers.get("authorization"),
      dependencies.configuredSecret,
    );
    if (authorization.ok === false) {
      return Response.json(
        { error: authorization.error },
        { status: authorization.status },
      );
    }

    try {
      const summary = await dependencies.run(
        dependencies.now?.() ?? new Date(),
      );
      return Response.json(summary, { status: 200 });
    } catch (error) {
      try {
        dependencies.logError(error);
      } catch {
        // Logging must not change the scheduler acknowledgement.
      }
      return Response.json(
        { error: "Daily portfolio valuation failed." },
        { status: 503 },
      );
    }
  };
}
