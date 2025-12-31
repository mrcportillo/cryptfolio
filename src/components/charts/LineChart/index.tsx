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

type ChartDataPoint = Record<string, number | string | Date>;

type LineChartProps = {
  data?: ChartDataPoint[];
  xKey: string;
  dataKeys?: string[];
};

export default function LineChart({
  data = [],
  xKey,
  dataKeys = [],
}: LineChartProps) {
  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      minHeight="400px"
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
        <YAxis />
        <Tooltip />
        <Legend />
        {dataKeys.map((dataKey) => (
          <Line
            key={`v${dataKey}`}
            type="monotone"
            dataKey={dataKey}
            stroke="#8884d8"
          />
        ))}
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
