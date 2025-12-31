import LineChart from "@/components/charts/LineChart";
import PageContainer from "@/components/pages/PageContainer";
import PageContent from "@/components/pages/PageContent";
import PageHeader from "@/components/pages/PageHeader";
import PageTitle from "@/components/pages/PageTitle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import listMarket from "@/services/coin/listMarket";
import marketChart from "@/services/coin/marketChart";
import type { CoinMarketItem } from "@/services/coin/types";

export const dynamic = "force-dynamic";

const MARKET_CAP_COUNT = 20;
const TOP_MOVERS_COUNT = 5;
const CHART_DAYS = 1;
const CHART_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

type TrendChartPoint = Record<string, number | string>;

type TrendCardData = {
  coin: CoinMarketItem;
  dataKey: string;
  chartData: TrendChartPoint[];
};

const formatPercent = (value: number) => `${value.toFixed(2)}%`;

const formatHourLabel = (date: Date) =>
  `${String(date.getHours()).padStart(2, "0")}:00`;

const formatMarketCap = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);

const getChange = (coin: CoinMarketItem) =>
  coin.price_change_percentage_24h ?? 0;

const buildHourlyTimeline = () => {
  const now = new Date();
  now.setMinutes(0, 0, 0);

  return Array.from({ length: CHART_HOURS }, (_, index) => {
    const date = new Date(now.getTime() - (CHART_HOURS - 1 - index) * HOUR_MS);
    return {
      timestamp: date.getTime(),
      label: formatHourLabel(date),
    };
  });
};

const buildChartData = (
  coinName: string,
  prices: [number, number][],
  timeline: ReturnType<typeof buildHourlyTimeline>,
) => {
  const dataKey = coinName;

  const hourlyBuckets = new Map<number, number>();
  for (const [timestamp, price] of prices) {
    const date = new Date(timestamp);
    date.setMinutes(0, 0, 0);
    hourlyBuckets.set(date.getTime(), price);
  }

  const initialPrice = prices.length ? prices[0][1] : null;
  let lastPrice: number | null = initialPrice;

  const chartData = timeline.map(({ timestamp, label }) => {
    const hourlyPrice = hourlyBuckets.get(timestamp);
    if (hourlyPrice !== undefined) {
      lastPrice = hourlyPrice;
    }

    return {
      hour: label,
      [dataKey]: lastPrice !== null ? Number(lastPrice.toFixed(2)) : null,
    };
  });

  return { dataKey, chartData };
};

async function getTopMovers(): Promise<CoinMarketItem[]> {
  try {
    const markets = await listMarket(MARKET_CAP_COUNT, 1);
    return [...markets]
      .sort((a, b) => Math.abs(getChange(b)) - Math.abs(getChange(a)))
      .slice(0, TOP_MOVERS_COUNT);
  } catch (error) {
    console.error("Error fetching market movers:", error);
    return [];
  }
}

async function getTrendCards(): Promise<TrendCardData[]> {
  const movers = await getTopMovers();
  if (!movers.length) {
    return [];
  }

  const timeline = buildHourlyTimeline();
  const charts = await Promise.all(
    movers.map(async (coin) => {
      try {
        const chart = await marketChart(coin.id, CHART_DAYS);
        const { dataKey, chartData } = buildChartData(
          coin.name,
          chart.prices,
          timeline,
        );
        return { coin, dataKey, chartData };
      } catch (error) {
        console.error(`Error fetching chart data for ${coin.id}:`, error);
        return { coin, dataKey: coin.name, chartData: [] };
      }
    }),
  );

  return charts;
}

export default async function TrendPage() {
  const trendCards = await getTrendCards();

  return (
    <PageContainer>
      <PageHeader>
        <div>
          <PageTitle>Trend</PageTitle>
          <p className="text-sm text-muted-foreground">
            Top 5 absolute 24h movers among the top 20 market cap coins.
          </p>
        </div>
      </PageHeader>
      <PageContent>
        {trendCards.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Trend data is unavailable right now. Please try again later.
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {trendCards.map(({ coin, dataKey, chartData }) => {
              const change = getChange(coin);
              return (
                <Card key={coin.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <CardTitle className="text-xl">{coin.name}</CardTitle>
                        <div className="text-sm text-muted-foreground">
                          {coin.symbol.toUpperCase()}
                        </div>
                        {coin.market_cap ? (
                          <div className="text-xs text-muted-foreground">
                            Market cap: {formatMarketCap(coin.market_cap)}
                          </div>
                        ) : null}
                      </div>
                      <div
                        className={cn(
                          "text-lg font-semibold",
                          change > 0 && "text-emerald-600",
                          change < 0 && "text-destructive",
                          change === 0 && "text-muted-foreground",
                        )}
                      >
                        {formatPercent(change)}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {chartData.length ? (
                      <LineChart
                        data={chartData}
                        xKey="hour"
                        dataKeys={[dataKey]}
                        minHeight={240}
                        showDots={false}
                      />
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        No chart data available.
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </PageContent>
    </PageContainer>
  );
}
