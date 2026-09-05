import Link from "next/link";
import { requireCurrentUser } from "@/lib/auth";
import { getWeeklyReport } from "@/services/portfolio-valuation/server";
import { shiftDate } from "@/services/portfolio-valuation/report-domain";
import PerformanceReport from "@/components/portfolio/PerformanceReport";

export default async function WeeklyPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await requireCurrentUser();
  const { week } = await searchParams;
  let data;
  try {
    data = await getWeeklyReport(user.id, week);
  } catch {
    return (
      <div className="m-6">
        <h1 className="text-2xl font-semibold">Weekly debrief</h1>
        <p className="my-4">
          This week cannot be loaded. Choose a valid post-adoption week or retry
          when data is available.
        </p>
        <Link className="underline" href="/reports/weekly">
          View current week
        </Link>
      </div>
    );
  }
  if (!data)
    return (
      <div className="m-6">
        <h1 className="text-2xl font-semibold">Weekly debrief</h1>
        <p className="mt-4">
          Weekly history starts after your portfolio adopts the transaction
          ledger.
        </p>
      </div>
    );
  const { window, report, adoptedAt } = data;
  return (
    <div className="mx-2 my-6 sm:mx-4 md:mx-8 lg:mx-20">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-700">
            Portfolio history
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-primary-950">
            Weekly debrief
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Week of {window.firstDate}
            {window.current ? " · In progress" : " · Closed week"}
          </p>
        </div>
        <nav
          aria-label="Report weeks"
          className="flex flex-wrap items-center gap-4 text-sm font-medium text-primary-800"
        >
          {window.startsAt > adoptedAt && (
            <Link
              className="underline"
              href={`/reports/weekly?week=${shiftDate(window.firstDate, -7)}`}
            >
              ← Previous week
            </Link>
          )}
          {!window.current && (
            <Link
              className="underline"
              href={`/reports/weekly?week=${window.nextDate}`}
            >
              Next week →
            </Link>
          )}
          <Link className="underline" href="/reports/weekly">
            Current week
          </Link>
        </nav>
      </header>
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium">
          Choose a date in the week
          <input
            type="date"
            name="week"
            required
            defaultValue={window.firstDate}
            className="mt-1 block rounded-md border border-primary-200 p-2"
          />
        </label>
        <button className="rounded-md bg-primary-800 px-4 py-2 text-sm font-medium text-white">
          View week
        </button>
      </form>
      <PerformanceReport report={report} weekly />
    </div>
  );
}
