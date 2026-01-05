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

type LineChartProps = {
  data?: ChartDataPoint[];
  xKey: string;
  dataKeys?: string[];
  minHeight?: number | string;
  showDots?: boolean;
  valueFormatter?: (value: number) => string;
};

export default function LineChart({
  data = [],
  xKey,
  dataKeys = [],
  minHeight = 400,
  showDots = true,
  valueFormatter,
}: LineChartProps) {
  const formatValue = (value: number | string | null) => {
    if (typeof value === "number" && valueFormatter) {
      return valueFormatter(value);
    }
    return value ?? "";
  };

  return (
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
            valueFormatter
              ? (value) =>
                  typeof value === "number"
                    ? valueFormatter(value)
                    : String(value)
              : undefined
          }
        />
        <Tooltip formatter={valueFormatter ? formatValue : undefined} />
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
  );
}
