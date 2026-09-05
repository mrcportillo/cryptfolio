import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LiveValuation } from "@/services/portfolio-valuation/domain";

type UserPortfolioValueProps = {
  valuation: LiveValuation;
};

function exactCurrency(value: string) {
  const [integer = "0", fraction = ""] = value.split(".");
  const negative = integer.startsWith("-");
  const unsignedInteger = negative ? integer.slice(1) : integer;
  const padded = `${fraction}000`;
  let cents = BigInt(unsignedInteger || "0") * BigInt(100);
  cents += BigInt(padded.slice(0, 2));
  if (padded[2] >= "5") cents += BigInt(1);
  const whole = (cents / BigInt(100))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimal = (cents % BigInt(100)).toString().padStart(2, "0");
  return `${negative ? "−" : ""}$${whole}.${decimal}`;
}

export default function UserPortfolioValue({
  valuation,
}: UserPortfolioValueProps) {
  const missingCount = valuation.positions.filter(
    (position) => position.priceUsd == null,
  ).length;
  const total = valuation.totalValueUsd;
  return (
    <Card className="w-full border-0 bg-gradient-to-br from-primary-700 via-primary-800 to-primary-950 shadow-lg">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-primary-50/90">
          Portfolio total worth
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="break-words text-5xl font-semibold text-white sm:text-6xl md:text-7xl"
          aria-live="polite"
        >
          {total === null ? "Worth incomplete" : exactCurrency(total)}
        </div>
        {valuation.valuationStatus === "INCOMPLETE" ? (
          <p className="mt-3 max-w-2xl text-sm text-white/90">
            {missingCount} {missingCount === 1 ? "asset is" : "assets are"}{" "}
            missing a current USD price. Missing prices are not treated as $0.
            Known subtotal: {exactCurrency(valuation.knownValueUsd)}.
          </p>
        ) : valuation.valuationStatus === "STALE" ? (
          <p className="mt-3 text-sm text-white/90">
            Last known worth — one or more prices are stale or could not be
            refreshed.
          </p>
        ) : (
          <p className="mt-3 text-sm text-white/90">Live market valuation</p>
        )}
      </CardContent>
    </Card>
  );
}
