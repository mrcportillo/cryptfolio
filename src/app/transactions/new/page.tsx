import { NotebookPen } from "lucide-react";
import TransactionForm from "@/components/transactions/TransactionForm";
import LedgerUnavailable from "@/components/transactions/LedgerUnavailable";
import {
  TransactionOperationBackLink,
  TransactionOperationShell,
} from "@/components/transactions/TransactionOperationShell";
import { requireCurrentUser } from "@/lib/auth";
import { formatPortfolioInputDate } from "@/lib/portfolio-transaction-ui";
import {
  ECONOMIC_EVENT_KINDS,
  type EconomicEventKind,
} from "@/services/portfolio-transactions/domain";
import { listOwnedTransactionPositions } from "@/services/portfolio-transactions/queries";
import listCoins from "@/services/coin/list";
import prisma from "@/services/prisma/client";
import type { CoinOption } from "@/types/coin";

type NewTransactionPageProps = {
  searchParams: Promise<{
    kind?: string;
    position?: string;
    positionId?: string;
  }>;
};

function requestedKind(value?: string): EconomicEventKind {
  return (ECONOMIC_EVENT_KINDS as readonly string[]).includes(value ?? "")
    ? (value as EconomicEventKind)
    : "BUY";
}

export default async function NewTransactionPage({
  searchParams,
}: NewTransactionPageProps) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const catalog = await listOwnedTransactionPositions(prisma, user.id);

  let coinOptions: CoinOption[] = [];
  let coinLoadError: string | undefined;
  if (catalog.ledgerAdopted) {
    try {
      coinOptions = (await listCoins(100)).map((coin) => ({
        value: coin.id,
        label: coin.name,
      }));
    } catch {
      coinLoadError =
        "Coin data is temporarily unavailable. Existing positions still work, but a new coin position cannot be created right now.";
    }
  }

  return (
    <div className="mx-2 my-6 sm:mx-4 md:mx-8 md:my-10 lg:mx-20">
      <TransactionOperationShell>
        <TransactionOperationBackLink href="/transactions">
          Transaction journal
        </TransactionOperationBackLink>
        <header className="mb-7 max-w-3xl">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary-700">
            <NotebookPen className="h-4 w-4" aria-hidden="true" />
            New journal entry
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-primary-950 sm:text-4xl">
            Record a transaction
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Capture the movement you know. Unknown USD values stay explicitly
            unvalued, ready for later valuation without inventing a price today.
          </p>
        </header>

        {!catalog.ledgerAdopted ? (
          <LedgerUnavailable />
        ) : (
          <section className="max-w-5xl rounded-xl border bg-[linear-gradient(to_bottom,rgba(242,247,251,0.7),rgba(255,255,255,1)_9rem)] p-5 shadow-sm sm:p-8">
            <TransactionForm
              positions={catalog.positions.map((position) => ({
                ...position,
                archivedAt: position.archivedAt?.toISOString() ?? null,
              }))}
              coinOptions={coinOptions}
              coinLoadError={coinLoadError}
              initialKind={requestedKind(params.kind)}
              initialOccurredLocal={formatPortfolioInputDate()}
              initialPositionId={
                catalog.positions.some(({ id }) => id === params.positionId)
                  ? params.positionId
                  : undefined
              }
              preferNewPosition={params.position === "new"}
            />
          </section>
        )}
      </TransactionOperationShell>
    </div>
  );
}
