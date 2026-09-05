export const PORTFOLIO_SNAPSHOT_CRON_PATH = "/api/cron/portfolio-snapshots";

export function isPortfolioSnapshotCronPath(pathname: string) {
  return pathname === PORTFOLIO_SNAPSHOT_CRON_PATH;
}
