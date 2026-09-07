import { requireCurrentUser } from "@/lib/auth";
import prisma from "@/services/prisma/client";
import { loadPortfolioMarkets } from "@/services/portfolio-valuation/server";
import { readOwnedInsights } from "@/services/portfolio-insights/store";
import InsightsView from "@/components/portfolio/InsightsView";
import MarketTrends from "@/components/portfolio/MarketTrends";
import { Suspense } from "react";
import { logServerError } from "@/lib/logger";

export const revalidate = 30;

async function PersonalInsights({ userId }: { userId: string }) {
  let data;
  try {
    data = await readOwnedInsights(prisma, userId, loadPortfolioMarkets);
  } catch (error) {
    logServerError("trend.personal-insights", error);
    return (
      <p role="status" className="m-6">
        Personal insights are temporarily unavailable.
      </p>
    );
  }
  return (
    <div className="mx-2 my-6 sm:mx-4 md:mx-8 lg:mx-20">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary-700">
          Personal market impact
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-primary-950">
          Portfolio tremors
        </h2>
      </header>
      <InsightsView data={data} />
    </div>
  );
}

export default async function TrendPage() {
  const user = await requireCurrentUser();
  return (
    <>
      <MarketTrends />
      <Suspense
        fallback={
          <p role="status" className="m-6">
            Loading personal insights…
          </p>
        }
      >
        <PersonalInsights userId={user.id} />
      </Suspense>
    </>
  );
}
