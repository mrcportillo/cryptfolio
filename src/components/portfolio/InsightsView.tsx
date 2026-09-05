import { formatValuationUsd } from "@/lib/valuation-ui";
import type { readOwnedInsights } from "@/services/portfolio-insights/store";
import InsightForm from "./InsightForm";
import InsightNumberInput from "./InsightNumberInput";

export default function InsightsView({
  data,
}: {
  data: Awaited<ReturnType<typeof readOwnedInsights>>;
}) {
  if (!data.ledgerAdopted)
    return (
      <p className="rounded-xl border p-5">
        Personal insights begin after your portfolio adopts the transaction
        ledger.
      </p>
    );
  return (
    <div className="space-y-7">
      <section className="rounded-xl border border-primary-200 bg-white p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-xl">
            <h2 className="text-xl font-semibold text-primary-950">
              What moved your portfolio
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Estimated 24-hour price impact using your current holdings at both
              prices. Transaction-adjusted performance is in your daily pulse.
            </p>
          </div>
          <InsightForm label="Save threshold">
            <input type="hidden" name="kind" value="threshold" />
            <label className="block text-sm font-medium">
              Minimum impact in USD
              <InsightNumberInput
                type="number"
                name="minimumImpactUsd"
                min="0"
                max="1000000000000"
                step="0.01"
                required
                initialValue={data.minimumImpactUsd}
                className="mt-1 block w-44 rounded-md border border-primary-200 p-2"
              />
            </label>
          </InsightForm>
        </div>
        {data.valuation.valuationStatus !== "COMPLETE" && (
          <p
            role="status"
            className="mt-5 rounded-lg bg-amber-50 p-3 text-sm text-amber-950"
          >
            Some prices are missing or stale. Available impacts are estimates;
            allocation warnings are paused until all prices are current.
          </p>
        )}
        {data.tremors.length ? (
          <ul className="mt-6 divide-y divide-primary-100">
            {data.tremors.map((coin) => (
              <li
                key={coin.assetId}
                className="flex flex-wrap items-center justify-between gap-3 py-4"
              >
                <div>
                  <p className="font-medium capitalize">
                    {coin.assetId.replaceAll("-", " ")}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {Number(coin.percent).toFixed(2)}% over 24 hours
                  </p>
                </div>
                <p className="text-xl font-semibold tabular-nums text-primary-950">
                  {formatValuationUsd(coin.impactUsd, true)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 text-sm text-slate-600">
            No priced holding crossed your impact threshold.
          </p>
        )}
      </section>
      <section className="rounded-xl border border-primary-200 bg-white p-5 sm:p-7">
        <h2 className="text-xl font-semibold text-primary-950">
          Allocation ranges
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Set a comfortable share for each named position. Adjustments assume a
          constant portfolio total and show a hypothetical shift within it.
        </p>
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          {data.positions.map((position) => {
            const target = data.targets.find(
              (target) => target.userAssetId === position.id,
            );
            const drift = data.drift.find(
              (target) => target.userAssetId === position.id,
            );
            return (
              <div
                key={position.id}
                className="rounded-lg border border-primary-100 p-4"
              >
                <h3 className="font-semibold text-primary-950">
                  {position.assetName}
                </h3>
                <p className="mb-3 text-xs text-slate-600">
                  {position.assetId}
                </p>
                <InsightForm>
                  <input type="hidden" name="kind" value="allocation" />
                  <input type="hidden" name="positionId" value={position.id} />
                  <div className="grid grid-cols-2 gap-3">
                    {(
                      [
                        ["minimumPct", "Minimum %", target?.minimumPct ?? "0"],
                        [
                          "maximumPct",
                          "Maximum %",
                          target?.maximumPct ?? "100",
                        ],
                      ] as const
                    ).map(([name, label, value]) => (
                      <label key={name} className="text-sm">
                        {label}
                        <InsightNumberInput
                          name={name}
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          required
                          initialValue={value}
                          className="mt-1 w-full rounded-md border border-primary-200 p-2"
                        />
                      </label>
                    ))}
                  </div>
                </InsightForm>
                {drift && (
                  <p className="mt-3 text-sm text-primary-950">
                    {drift.status === "INCOMPLETE"
                      ? "Allocation unavailable until prices are current."
                      : drift.status === "IN_RANGE"
                        ? `Within range · ${drift.allocation}%`
                        : `${drift.status === "ABOVE" ? "Above" : "Below"} range · ${drift.allocation}% · ${formatValuationUsd(drift.adjustmentUsd, true)} hypothetical adjustment`}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {data.positions.length === 0 && (
          <p className="mt-4 text-sm">
            Record a transaction to add a position.
          </p>
        )}
      </section>
    </div>
  );
}
