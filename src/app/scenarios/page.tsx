import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireCurrentUser } from "@/lib/auth";
import prisma from "@/services/prisma/client";
import { loadPortfolioMarkets } from "@/services/portfolio-valuation/server";
import {
  readOwnedInsights,
  listOwnedScenarios,
} from "@/services/portfolio-insights/store";
import { runStressScenario } from "@/services/portfolio-insights/domain";
import ScenarioForm from "@/components/portfolio/ScenarioForm";
import ScenarioResults from "@/components/portfolio/ScenarioResults";
import InsightForm from "@/components/portfolio/InsightForm";

export default async function ScenariosPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const user = await requireCurrentUser();
  const { run } = await searchParams;
  const [data, scenarios] = await Promise.all([
    readOwnedInsights(prisma, user.id, loadPortfolioMarkets),
    listOwnedScenarios(prisma, user.id),
  ]);
  const selected = scenarios.find((scenario) => scenario.id === run);
  const coins = [
    ...new Set(
      data.positions
        .filter((position) => position.canSpend)
        .map((position) => position.assetId),
    ),
  ];
  return (
    <div className="mx-2 my-6 sm:mx-4 md:mx-8 lg:mx-20">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary-700">
          Portfolio stress laboratory
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-primary-950">
          What if prices changed?
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Save a set of price shocks, then explore its impact on your portfolio.
        </p>
      </header>
      {!data.ledgerAdopted ? (
        <p>Scenarios become available after portfolio adoption.</p>
      ) : (
        <div className="space-y-7">
          {run && !selected && (
            <p role="status" className="rounded-lg border p-4">
              That scenario is unavailable.
            </p>
          )}
          {selected && (
            <ScenarioResults
              name={selected.name}
              result={runStressScenario(data.valuation, selected.shocks)}
            />
          )}
          <div className="grid items-start gap-7 lg:grid-cols-2">
            <section className="rounded-xl border border-primary-200 p-5 sm:p-7">
              <h2 className="mb-5 text-xl font-semibold text-primary-950">
                New scenario
              </h2>
              <ScenarioForm coins={coins} creationKey={randomUUID()} />
              <a
                href="/scenarios"
                className="mt-4 inline-block text-sm text-primary-800 underline"
              >
                Clear form and create another
              </a>
            </section>
            <section>
              <h2 className="mb-4 text-xl font-semibold text-primary-950">
                Saved scenarios
              </h2>
              {scenarios.length === 0 && (
                <p className="text-sm text-slate-600">
                  Your saved scenarios will appear here.
                </p>
              )}
              <div className="space-y-4">
                {scenarios.map((scenario) => (
                  <article
                    key={scenario.id}
                    className="rounded-xl border border-primary-200 p-5"
                  >
                    <h3 className="text-lg font-semibold text-primary-950">
                      {scenario.name}
                    </h3>
                    <p className="mt-2 text-sm text-slate-600">
                      {scenario.shocks
                        .map((shock) => `${shock.assetId}: ${shock.percent}%`)
                        .join(" · ")}
                    </p>
                    <Link
                      href={`/scenarios?run=${scenario.id}`}
                      className="my-4 inline-block rounded-md bg-primary-800 px-4 py-2 text-sm font-medium text-white"
                    >
                      Run scenario
                    </Link>
                    <details className="mb-4">
                      <summary className="cursor-pointer text-sm font-medium text-primary-800">
                        Edit scenario
                      </summary>
                      <div className="mt-4">
                        <ScenarioForm scenario={scenario} coins={coins} />
                      </div>
                    </details>
                    <InsightForm label="Archive scenario">
                      <input type="hidden" name="kind" value="archive" />
                      <input
                        type="hidden"
                        name="scenarioId"
                        value={scenario.id}
                      />
                    </InsightForm>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
