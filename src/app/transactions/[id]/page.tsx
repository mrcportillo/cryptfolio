import { CalendarClock } from "lucide-react";
import { notFound } from "next/navigation";
import TransactionForm from "@/components/transactions/TransactionForm";
import {
  TransactionEventDetails,
  type PositionNames,
} from "@/components/transactions/TransactionEvent";
import TransactionReversal from "@/components/transactions/TransactionReversal";
import {
  TransactionCorrectionPanel,
  TransactionOperationBackLink,
  TransactionOperationShell,
} from "@/components/transactions/TransactionOperationShell";
import { requireCurrentUser } from "@/lib/auth";
import { transactionFormValuesFromEvent } from "@/lib/portfolio-transaction-form";
import {
  formatPortfolioDate,
  transactionKindLabel,
} from "@/lib/portfolio-transaction-ui";
import listCoins from "@/services/coin/list";
import { isEconomicEventKind } from "@/services/portfolio-transactions/domain";
import {
  findOwnedPortfolioEvent,
  listOwnedTransactionPositions,
} from "@/services/portfolio-transactions/queries";
import prisma from "@/services/prisma/client";
import type { CoinOption } from "@/types/coin";

type TransactionPageProps = {
  params: Promise<{ id: string }>;
};

export default async function TransactionPage({
  params,
}: TransactionPageProps) {
  const { id } = await params;
  const user = await requireCurrentUser();
  const catalog = await listOwnedTransactionPositions(prisma, user.id);
  if (!catalog.ledgerAdopted) notFound();
  const event = await findOwnedPortfolioEvent(prisma, user.id, id);
  if (!event) notFound();

  const positionNames: PositionNames = Object.fromEntries(
    catalog.positions.map((position) => [
      position.id,
      { assetName: position.assetName, assetId: position.assetId },
    ]),
  );
  const canChange =
    isEconomicEventKind(event.kind) &&
    event.reversedByEventId === null &&
    event.replacedByEventId === null;

  let coinOptions: CoinOption[] = [];
  let coinLoadError: string | undefined;
  if (canChange) {
    try {
      coinOptions = (await listCoins(100)).map((coin) => ({
        value: coin.id,
        label: coin.name,
      }));
    } catch {
      coinLoadError =
        "Coin data is temporarily unavailable. Existing positions still work, but a correction cannot create a new coin position right now.";
    }
  }

  const positionOptions = catalog.positions.map((position) => ({
    ...position,
    archivedAt: position.archivedAt?.toISOString() ?? null,
  }));

  return (
    <div className="mx-2 my-6 sm:mx-4 md:mx-8 md:my-10 lg:mx-20">
      <TransactionOperationShell>
        <TransactionOperationBackLink href="/transactions">
          Transaction journal
        </TransactionOperationBackLink>

        <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <article className="min-w-0 rounded-xl border bg-[linear-gradient(to_bottom,rgba(242,247,251,0.75),rgba(255,255,255,1)_10rem)] p-5 shadow-sm sm:p-8">
            <header className="mb-7 border-b border-primary-200 pb-6">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary-700">
                <CalendarClock className="h-4 w-4" aria-hidden="true" />
                {formatPortfolioDate(event.occurredAt)}
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-primary-950 sm:text-4xl">
                {transactionKindLabel(event.kind)}
              </h1>
              <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                Event {event.id}
              </p>
            </header>
            <TransactionEventDetails
              event={event}
              positionNames={positionNames}
            />
          </article>

          <aside className="space-y-4" aria-label="Transaction actions">
            <section className="rounded-xl border bg-white p-5 shadow-sm">
              <h2 className="font-semibold text-primary-950">
                Durable history
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Events are never edited or deleted. Reverse an entry exactly, or
                correct it with one atomic reversal-and-replacement pair.
              </p>
              {canChange ? (
                <div className="mt-5">
                  <TransactionReversal eventId={event.id} />
                </div>
              ) : (
                <p className="mt-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                  This event is historical and cannot be reversed or corrected
                  again.
                </p>
              )}
            </section>
          </aside>
        </div>

        {canChange ? (
          <TransactionCorrectionPanel>
            <TransactionForm
              positions={positionOptions}
              coinOptions={coinOptions}
              coinLoadError={coinLoadError}
              correction={{
                eventId: event.id,
                initialValues: transactionFormValuesFromEvent(event),
              }}
              cancelHref="/transactions"
            />
          </TransactionCorrectionPanel>
        ) : null}
      </TransactionOperationShell>
    </div>
  );
}
