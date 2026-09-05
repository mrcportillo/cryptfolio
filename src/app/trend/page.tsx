import { requireCurrentUser } from "@/lib/auth";
import prisma from "@/services/prisma/client";
import { loadPortfolioMarkets } from "@/services/portfolio-valuation/server";
import { readOwnedInsights } from "@/services/portfolio-insights/store";
import InsightsView from "@/components/portfolio/InsightsView";

export default async function TrendPage() {
  const user = await requireCurrentUser();
  const data = await readOwnedInsights(prisma, user.id, loadPortfolioMarkets);
  return (
    <div className="mx-2 my-6 sm:mx-4 md:mx-8 lg:mx-20">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary-700">
          Personal market impact
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-primary-950">
          Portfolio tremors
        </h1>
      </header>
      <InsightsView data={data} />
    </div>
  );
}
