"use client";

import dynamic from "next/dynamic";
import type { LineChartProps } from "./index";

const LineChart = dynamic(() => import("./index"), {
  ssr: false,
  loading: () => (
    <div
      className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground"
      role="status"
    >
      Loading chart...
    </div>
  ),
});

export default function LazyLineChart(props: LineChartProps) {
  return <LineChart {...props} />;
}
