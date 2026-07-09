import { formatCurrency } from "@/utils/numbers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type UserPortfolioValueProps = {
  value: number;
};

export default function UserPortfolioValue({ value }: UserPortfolioValueProps) {
  return (
    <Card className="w-full border-0 bg-gradient-to-br from-primary-200 via-primary-400 to-primary-700 shadow-lg">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-primary-50/90">
          Portfolio total worth
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-5xl font-semibold text-white sm:text-6xl md:text-7xl">
          {formatCurrency(value)}
        </div>
      </CardContent>
    </Card>
  );
}
