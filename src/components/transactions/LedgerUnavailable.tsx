import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LedgerUnavailable() {
  return (
    <section
      className="max-w-2xl rounded-lg border border-primary-200 bg-primary-50/70 p-6"
      aria-labelledby="ledger-setup-heading"
    >
      <div className="flex items-start gap-4">
        <div className="rounded-full bg-white p-2 text-primary-700 shadow-sm">
          <LockKeyhole className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2
            id="ledger-setup-heading"
            className="font-semibold text-primary-950"
          >
            Transaction journal is not active yet
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your current holdings still use legacy editing. They become opening
            balances during the one-time ledger cutover; no historical activity
            is backfilled, and this page does not change any data.
          </p>
          <Button asChild variant="outline" className="mt-4 bg-white">
            <Link href="/home">Return to current assets</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
