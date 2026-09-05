import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function TransactionNotFound() {
  return (
    <div className="mx-2 my-10 sm:mx-4 md:mx-8 lg:mx-20">
      <div className="max-w-lg rounded-xl border bg-white p-7 shadow-sm">
        <h1 className="text-3xl font-semibold text-primary-950">
          Transaction not found
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          This journal entry does not exist or does not belong to your
          portfolio.
        </p>
        <Button asChild className="mt-5">
          <Link href="/transactions">Return to transactions</Link>
        </Button>
      </div>
    </div>
  );
}
