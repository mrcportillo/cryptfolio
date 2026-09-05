import { formatValuationUsd } from "@/lib/valuation-ui";
import type { runStressScenario } from "@/services/portfolio-insights/domain";

export default function ScenarioResults({
  name,
  result,
}: {
  name: string;
  result: ReturnType<typeof runStressScenario>;
}) {
  return (
    <section
      aria-label="Scenario results"
      className="rounded-xl border border-primary-200 bg-primary-50 p-5 sm:p-7"
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-primary-700">
        Hypothetical result
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-primary-950">{name}</h2>
      <p className="mt-2 text-sm text-slate-600">
        These shocks apply to current quantities and prices. Saving or running a
        scenario leaves holdings and history unchanged.
      </p>
      <dl className="my-6 grid gap-4 sm:grid-cols-3">
        {(
          [
            ["Current worth", result.currentValueUsd],
            ["After shocks", result.projectedValueUsd],
            ["Hypothetical change", result.impactUsd],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-slate-600">{label}</dt>
            <dd className="mt-1 break-all text-2xl font-semibold text-primary-950">
              {formatValuationUsd(value, label === "Hypothetical change")}
            </dd>
          </div>
        ))}
      </dl>
      {result.status !== "COMPLETE" && (
        <p
          role="status"
          className="rounded-md bg-amber-50 p-3 text-sm text-amber-950"
        >
          Incomplete estimate: one or more current prices are missing or stale.
          Known projected subtotal:{" "}
          {formatValuationUsd(result.knownProjectedValueUsd)}.
        </p>
      )}
      <ul className="mt-4 divide-y divide-primary-200">
        {result.coins.map((coin) => (
          <li
            key={coin.assetId}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div>
              <p className="font-medium capitalize">
                {coin.assetId.replaceAll("-", " ")}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                {coin.percent}% shock{!coin.held ? " · Not currently held" : ""}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold">
                {formatValuationUsd(coin.impactUsd, true)}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                After: {formatValuationUsd(coin.projectedValueUsd)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
