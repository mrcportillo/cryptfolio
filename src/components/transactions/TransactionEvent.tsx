import Link from "next/link";
import { ArrowRight, ExternalLink, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatExactUsd,
  formatPortfolioDate,
  formatSignedQuantity,
  movementPriceProvenance,
  transactionKindLabel,
} from "@/lib/portfolio-transaction-ui";
import type { TransactionEventReadModel } from "@/services/portfolio-transactions/queries";

export type PositionNames = Record<
  string,
  { assetName: string; assetId: string }
>;

function positionLabel(positionNames: PositionNames, id: string) {
  const position = positionNames[id];
  return position
    ? `${position.assetName} · ${position.assetId}`
    : "Unknown position";
}

function eventStatus(event: TransactionEventReadModel) {
  if (event.replacedByEventId) return "Corrected";
  if (event.reversedByEventId) return "Reversed";
  if (event.kind === "REVERSAL") return "Reversal entry";
  if (event.replacementForEventId) return "Correction entry";
  return "Recorded";
}

function StatusBadge({ event }: { event: TransactionEventReadModel }) {
  const status = eventStatus(event);
  const historical = status === "Corrected" || status === "Reversed";
  return (
    <span
      className={
        historical
          ? "rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900"
          : "rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-900"
      }
    >
      {status}
    </span>
  );
}

function MoneyDatum({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-sm font-medium tabular-nums text-primary-950">
        {formatExactUsd(value)}
      </dd>
    </div>
  );
}

function relatedEventLinks(event: TransactionEventReadModel) {
  return [
    event.reversalOfEventId
      ? { label: "Original reversed", id: event.reversalOfEventId }
      : null,
    event.replacementForEventId
      ? { label: "Original corrected", id: event.replacementForEventId }
      : null,
    event.reversedByEventId
      ? { label: "Reversal entry", id: event.reversedByEventId }
      : null,
    event.replacedByEventId
      ? { label: "Replacement entry", id: event.replacedByEventId }
      : null,
  ].filter((link): link is { label: string; id: string } => Boolean(link));
}

function RelatedEvents({ event }: { event: TransactionEventReadModel }) {
  const links = relatedEventLinks(event);

  if (links.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-950">
        <Link2 className="h-4 w-4" aria-hidden="true" />
        Permanent record links
      </h2>
      <ul className="mt-2 space-y-1 text-sm">
        {links.map((link) => (
          <li key={`${link.label}-${link.id}`}>
            <Link
              href={`/transactions/${link.id}`}
              className="inline-flex items-center gap-1 text-amber-950 underline decoration-amber-400 underline-offset-4 hover:text-amber-700"
            >
              {link.label}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TransactionHistoryItem({
  event,
  positionNames,
}: {
  event: TransactionEventReadModel;
  positionNames: PositionNames;
}) {
  const relatedLinks = relatedEventLinks(event);
  return (
    <article className="group relative overflow-hidden rounded-lg border bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="absolute inset-y-0 left-0 w-1 bg-primary-300 group-hover:bg-primary-500" />
      <div className="grid gap-4 p-5 pl-6 lg:grid-cols-[minmax(10rem,0.7fr)_minmax(15rem,1.2fr)_minmax(20rem,1fr)_auto] lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-primary-950">
              {transactionKindLabel(event.kind)}
            </h2>
            <StatusBadge event={event} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatPortfolioDate(event.occurredAt)}
          </p>
        </div>
        <ul className="space-y-2">
          {event.movements.map((movement) => (
            <li
              key={`${movement.userAssetId}-${movement.role}`}
              className="text-sm"
            >
              <div className="flex items-baseline justify-between gap-4">
                <span className="min-w-0 truncate text-muted-foreground">
                  {movement.role === "FEE" ? "Fee · " : ""}
                  {positionLabel(positionNames, movement.userAssetId)}
                </span>
                <span className="shrink-0 font-mono font-medium tabular-nums text-primary-950">
                  {formatSignedQuantity(movement.quantityDelta)}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {movementPriceProvenance(movement)}
                {movement.unitPriceUsd !== null
                  ? ` · ${formatExactUsd(movement.unitPriceUsd)} per coin`
                  : ""}
              </div>
            </li>
          ))}
        </ul>
        <dl className="grid grid-cols-3 gap-3">
          <MoneyDatum label="Actual value" value={event.actualValueUsd} />
          <MoneyDatum label="External flow" value={event.externalFlowUsd} />
          <MoneyDatum label="Fee value" value={event.feeUsd} />
        </dl>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="justify-self-start lg:justify-self-end"
        >
          <Link href={`/transactions/${event.id}`}>
            Inspect
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
      {event.note || relatedLinks.length > 0 ? (
        <div className="flex flex-col gap-2 border-t bg-primary-50/30 px-5 py-3 pl-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          {event.note ? (
            <p className="line-clamp-2 max-w-2xl whitespace-pre-wrap">
              Note: {event.note}
            </p>
          ) : (
            <span />
          )}
          {relatedLinks.length > 0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {relatedLinks.map((link) => (
                <Link
                  key={`${link.label}-${link.id}`}
                  href={`/transactions/${link.id}`}
                  className="text-primary-800 underline decoration-primary-300 underline-offset-4 hover:text-primary-600"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function TransactionEventDetails({
  event,
  positionNames,
}: {
  event: TransactionEventReadModel;
  positionNames: PositionNames;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge event={event} />
        <span className="text-sm text-muted-foreground">
          Recorded {formatPortfolioDate(event.createdAt)}
        </span>
      </div>

      <section aria-labelledby="movement-heading">
        <h2
          id="movement-heading"
          className="text-sm font-semibold uppercase tracking-[0.14em] text-primary-950"
        >
          Ledger legs
        </h2>
        <div className="mt-3 overflow-hidden rounded-lg border">
          {event.movements.map((movement, index) => (
            <div
              key={`${movement.userAssetId}-${movement.role}`}
              className={`grid gap-3 bg-white p-4 sm:grid-cols-[1fr_auto] sm:items-center ${index > 0 ? "border-t" : ""}`}
            >
              <div>
                <div className="font-medium text-primary-950">
                  {positionLabel(positionNames, movement.userAssetId)}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {movement.role === "FEE" ? "Fee leg" : "Principal leg"}
                  </span>
                  <span>{movementPriceProvenance(movement)}</span>
                  {movement.unitPriceUsd !== null ? (
                    <span>
                      {formatExactUsd(movement.unitPriceUsd)} per coin
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="font-mono text-lg font-semibold tabular-nums text-primary-950">
                {formatSignedQuantity(movement.quantityDelta)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="money-heading">
        <h2
          id="money-heading"
          className="text-sm font-semibold uppercase tracking-[0.14em] text-primary-950"
        >
          Money evidence
        </h2>
        <dl className="mt-3 grid gap-4 rounded-lg border bg-primary-50/40 p-4 sm:grid-cols-3">
          <MoneyDatum label="Actual USD value" value={event.actualValueUsd} />
          <MoneyDatum label="External flow" value={event.externalFlowUsd} />
          <MoneyDatum label="Fee value" value={event.feeUsd} />
        </dl>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Unknown amounts remain unvalued. Zero appears only when the ledger
          explicitly records a known zero.
        </p>
      </section>

      {event.note ? (
        <section aria-labelledby="note-heading">
          <h2
            id="note-heading"
            className="text-sm font-semibold uppercase tracking-[0.14em] text-primary-950"
          >
            Note
          </h2>
          <p className="mt-3 whitespace-pre-wrap rounded-lg border bg-white p-4 text-sm leading-6">
            {event.note}
          </p>
        </section>
      ) : null}

      <RelatedEvents event={event} />
    </div>
  );
}
