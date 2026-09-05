import { ArrowDownRight, ArrowUpRight, Info } from "lucide-react";
import { formatValuationUsd, reportTimestamp } from "@/lib/valuation-ui";
import { compareDecimals } from "@/services/portfolio-transactions/decimal";
import type { PortfolioReport } from "@/services/portfolio-valuation/reports";

export default function PerformanceReport({
  report,
  weekly = false,
}: {
  report: PortfolioReport;
  weekly?: boolean;
}) {
  const result = report.calculation;
  const complete = result?.status === "COMPLETE";
  const movement = complete ? result.marketMovementUsd : null;
  const gains = movement !== null && compareDecimals(movement, "0") >= 0;
  const CoinArrow = gains ? ArrowUpRight : ArrowDownRight;
  const coins = result?.coins ?? [];
  const shownCoins = weekly
    ? coins
    : [
        ...coins
          .filter(
            (coin) =>
              coin.marketMovementUsd !== null &&
              compareDecimals(coin.marketMovementUsd, "0") > 0,
          )
          .slice(0, 3),
        ...coins
          .filter(
            (coin) =>
              coin.marketMovementUsd !== null &&
              compareDecimals(coin.marketMovementUsd, "0") < 0,
          )
          .slice(0, 3),
      ];
  return (
    <section
      aria-label={weekly ? "Weekly performance" : "Daily pulse"}
      className="rounded-xl border border-primary-200 bg-white p-5 shadow-sm sm:p-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-primary-950">
            {weekly ? "Your week, explained" : "Daily pulse"}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {report.startedAt
              ? `Since ${reportTimestamp(report.startedAt)} · Salta time`
              : "Waiting for the first valued baseline"}
          </p>
        </div>
        <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-900">
          {complete ? "Reconciled" : "Incomplete performance"}
        </span>
      </div>
      <div className="my-6">
        <p className="text-sm text-slate-600">Market movement</p>
        <p
          className={`mt-1 flex items-center gap-2 break-all text-3xl font-semibold sm:text-4xl ${movement === null ? "text-slate-700" : gains ? "text-emerald-800" : "text-rose-800"}`}
        >
          {movement !== null && (
            <CoinArrow aria-hidden="true" className="h-7 w-7 shrink-0" />
          )}
          {formatValuationUsd(movement, true)}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          External contributions and withdrawals are separated from performance.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-5 border-y border-primary-100 py-5 lg:grid-cols-5">
        {(
          [
            ["Starting worth", result?.startingValueUsd ?? null, false],
            ["External flow", result?.netExternalFlowUsd ?? null, true],
            ["Fees paid", result?.feesUsd ?? null, false],
            ["Ending worth", result?.endingValueUsd ?? null, false],
            ["Total change", result?.totalChangeUsd ?? null, true],
          ] as const
        ).map(([label, value, signed]) => (
          <div key={label}>
            <dt className="text-xs font-medium text-slate-600">{label}</dt>
            <dd className="mt-1 break-all text-lg font-semibold text-primary-950">
              {formatValuationUsd(value, signed)}
            </dd>
          </div>
        ))}
      </dl>
      {(report.message || report.quality.length > 0) && (
        <div className="mt-5 flex gap-2 rounded-lg bg-primary-50 p-3 text-sm text-primary-950">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            {report.message && <p>{report.message}</p>}
            {report.quality.length > 0 && (
              <p className={report.message ? "mt-1" : ""}>
                {report.quality.join(" · ")}
              </p>
            )}
          </div>
        </div>
      )}
      {complete && (
        <div className="mt-6">
          <h3 className="font-semibold text-primary-950">
            {weekly
              ? "Coin contributions and allocation"
              : "Largest positive and negative contributors"}
          </h3>
          {shownCoins.length ? (
            <ul className="mt-3 divide-y divide-primary-100">
              {shownCoins.map((coin) => (
                <li
                  key={coin.assetId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="font-medium capitalize">
                      {coin.assetId.replaceAll("-", " ")}
                    </p>
                    {weekly && (
                      <p className="mt-1 text-xs text-slate-600">
                        Allocation:{" "}
                        {coin.startingAllocation === null
                          ? "Unavailable"
                          : `${coin.startingAllocation}%`}{" "}
                        →{" "}
                        {coin.endingAllocation === null
                          ? "Unavailable"
                          : `${coin.endingAllocation}%`}
                      </p>
                    )}
                  </div>
                  <p className="font-semibold tabular-nums">
                    {formatValuationUsd(coin.marketMovementUsd, true)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-600">
              No coin-price contribution during this period.
            </p>
          )}
          <details className="mt-5 text-sm text-slate-600">
            <summary className="cursor-pointer font-medium text-primary-900">
              How these figures reconcile
            </summary>
            <p className="mt-2">
              Ending worth = starting worth + external flow + market movement −
              fees.
            </p>
            <p className="mt-1">
              Reference-price movement:{" "}
              {formatValuationUsd(result.priceMovementUsd, true)}. Transaction
              valuation adjustment:{" "}
              {formatValuationUsd(result.eventValuationAdjustmentUsd, true)}.
              The adjustment accounts for recorded transaction values differing
              from reference market prices.
            </p>
          </details>
        </div>
      )}
    </section>
  );
}
