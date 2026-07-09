"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ChartDataPoint = Record<string, number | string | Date | null>;

export type LineChartProps = {
  data?: ChartDataPoint[];
  xKey: string;
  dataKeys?: string[];
  minHeight?: number | string;
  showDots?: boolean;
  valueFormatOptions?: Intl.NumberFormatOptions;
  valueLocale?: string;
  ariaLabel?: string;
};

export default function LineChart({
  data = [],
  xKey,
  dataKeys = [],
  minHeight = 400,
  showDots = true,
  valueFormatOptions,
  valueLocale = "en-US",
  ariaLabel = "Line chart",
}: LineChartProps) {
  const numberFormatter = valueFormatOptions
    ? new Intl.NumberFormat(valueLocale, valueFormatOptions)
    : null;

  const formatValue = (value: number | string | null) => {
    if (typeof value === "number" && numberFormatter) {
      return numberFormatter.format(value);
    }
    return value ?? "";
  };

  return (
    <div role="img" aria-label={ariaLabel} className="min-w-0">
      <ResponsiveContainer
        width="100%"
        height="100%"
        minHeight={minHeight}
        minWidth="200px"
      >
        <RechartsLineChart
          data={data}
          margin={{
            top: 5,
            right: 30,
            left: 20,
            bottom: 5,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xKey} />
          <YAxis
            tickFormatter={
              numberFormatter
                ? (value) =>
                    typeof value === "number"
                      ? numberFormatter.format(value)
                      : String(value)
                : undefined
            }
          />
          <Tooltip formatter={numberFormatter ? formatValue : undefined} />
          <Legend />
          {dataKeys.map((dataKey) => (
            <Line
              key={`v${dataKey}`}
              type="monotone"
              dataKey={dataKey}
              stroke="#8884d8"
              dot={showDots}
              activeDot={showDots}
            />
          ))}
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
}
