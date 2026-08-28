import Link from "next/link";
import { BookOpenText, Plus } from "lucide-react";
import { requireCurrentUser } from "@/lib/auth";
import { parsePagination } from "@/lib/pagination";
import prisma from "@/services/prisma/client";
import {
  listOwnedPortfolioEvents,
  listOwnedTransactionPositions,
} from "@/services/portfolio-transactions/queries";
import LedgerUnavailable from "@/components/transactions/LedgerUnavailable";
import {
  TransactionHistoryItem,
  type PositionNames,
} from "@/components/transactions/TransactionEvent";
import { Button } from "@/components/ui/button";

const TRANSACTION_PAGE_SIZE = 20;

type TransactionsPageProps = {
  searchParams: Promise<{ page?: string }>;
};

function PageLink({
  page,
  disabled,
  children,
}: {
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link
        href={`/transactions?page=${page}`}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : undefined}
        className={disabled ? "pointer-events-none opacity-50" : undefined}
      >
        {children}
      </Link>
    </Button>
  );
}

export default async function TransactionsPage({
  searchParams,
}: TransactionsPageProps) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const pagination = parsePagination(
    new URLSearchParams({
      ...(params.page ? { page: params.page } : {}),
      pageSize: String(TRANSACTION_PAGE_SIZE),
    }),
  );
  const catalog = await listOwnedTransactionPositions(prisma, user.id);

  if (!catalog.ledgerAdopted) {
    return (
      <div className="mx-2 my-6 sm:mx-4 md:mx-8 md:my-10 lg:mx-20">
        <header className="mb-7 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-700">
            Personal field journal
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-primary-950 sm:text-4xl">
            Transactions
          </h1>
        </header>
        <LedgerUnavailable />
      </div>
    );
  }

  const { events, hasMore } = await listOwnedPortfolioEvents(prisma, user.id, {
    page: pagination.page,
    pageSize: pagination.pageSize,
  });
  const positionNames: PositionNames = Object.fromEntries(
    catalog.positions.map((position) => [
      position.id,
      { assetName: position.assetName, assetId: position.assetId },
    ]),
  );

  return (
    <div className="mx-2 my-6 sm:mx-4 md:mx-8 md:my-10 lg:mx-20">
      <header className="mb-8 flex flex-col gap-5 border-b border-primary-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary-700">
            <BookOpenText className="h-4 w-4" aria-hidden="true" />
            Personal field journal
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-primary-950 sm:text-4xl">
            Transactions
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Durable movements, actual values, and corrections. Market-driven
            valuation arrives separately; this journal records only what you
            did.
          </p>
        </div>
        <Button asChild>
          <Link href="/transactions/new">
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Record transaction
          </Link>
        </Button>
      </header>

      {events.length > 0 ? (
        <div className="space-y-3">
          {events.map((event) => (
            <TransactionHistoryItem
              key={event.id}
              event={event}
              positionNames={positionNames}
            />
          ))}
        </div>
      ) : (
        <section className="rounded-lg border border-dashed border-primary-300 bg-primary-50/40 p-10 text-center">
          <h2 className="font-semibold text-primary-950">
            The journal is quiet
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Opening balances exist, but no manual transaction has been recorded
            yet.
          </p>
          <Button asChild className="mt-5">
            <Link href="/transactions/new">Write the first entry</Link>
          </Button>
        </section>
      )}

      <nav
        aria-label="Transaction pages"
        className="mt-6 flex items-center justify-between border-t pt-4"
      >
        <p className="text-sm text-muted-foreground">Page {pagination.page}</p>
        <div className="flex gap-2">
          <PageLink
            page={Math.max(1, pagination.page - 1)}
            disabled={pagination.page === 1}
          >
            Previous
          </PageLink>
          <PageLink page={pagination.page + 1} disabled={!hasMore}>
            Next
          </PageLink>
        </div>
      </nav>
    </div>
  );
}
