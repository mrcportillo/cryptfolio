import Link from "next/link";
import { getDailyReport } from "@/services/portfolio-valuation/server";
import PerformanceReport from "./PerformanceReport";

export default async function DailyPulse({ userId }: { userId: string }) {
  let report;
  try {
    report = await getDailyReport(userId);
  } catch {
    return (
      <p
        role="status"
        className="rounded-lg border border-primary-200 p-5 text-sm"
      >
        Daily performance is temporarily unavailable. Your holdings remain
        available; refresh to try again.
      </p>
    );
  }
  return (
    <div className="mb-6">
      <PerformanceReport report={report} />
      <div className="mt-3 flex justify-end">
        <Link
          href="/reports/weekly"
          className="text-sm font-medium text-primary-800 underline underline-offset-4"
        >
          Open weekly debrief →
        </Link>
      </div>
    </div>
  );
}
