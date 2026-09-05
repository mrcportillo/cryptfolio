import Link from "next/link";
import prisma from "@/services/prisma/client";
import { loadPortfolioMarkets } from "@/services/portfolio-valuation/server";
import { readOwnedInsights } from "@/services/portfolio-insights/store";
import { formatValuationUsd } from "@/lib/valuation-ui";

export default async function AllocationWarnings({
  userId,
}: {
  userId: string;
}) {
  let data;
  try {
    data = await readOwnedInsights(prisma, userId, loadPortfolioMarkets);
  } catch {
    return null;
  }
  const warnings = data.drift.filter(
    (target) => target.status === "ABOVE" || target.status === "BELOW",
  );
  if (warnings.length === 0) return null;
  return (
    <aside
      aria-label="Allocation warnings"
      className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
    >
      <h2 className="font-semibold">Outside your allocation ranges</h2>
      <ul className="mt-2 space-y-1">
        {warnings.map((target) => (
          <li key={target.userAssetId}>
            {
              data.positions.find(
                (position) => position.id === target.userAssetId,
              )?.assetName
            }
            : {target.status === "ABOVE" ? "above" : "below"} range ·{" "}
            {formatValuationUsd(target.adjustmentUsd, true)} hypothetical
            adjustment.
          </li>
        ))}
      </ul>
      <Link href="/trend" className="mt-2 inline-block underline">
        Review allocation ranges
      </Link>
    </aside>
  );
}
