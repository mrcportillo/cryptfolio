"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { ArrowLeft, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createClientOperationGuard,
  type ClientOperationKind,
  type ClientOperationSnapshot,
  type ClientOperationToken,
} from "@/lib/client-operation-guard";

type TransactionOperationContextValue = {
  snapshot: ClientOperationSnapshot;
  busy: boolean;
  acquire(kind: ClientOperationKind): ClientOperationToken | null;
  release(token: ClientOperationToken): void;
  markNavigating(token: ClientOperationToken): void;
  isBusy(): boolean;
};

const TransactionOperationContext =
  createContext<TransactionOperationContextValue | null>(null);

export function TransactionOperationShell({
  children,
}: {
  children: ReactNode;
}) {
  const guard = useRef(createClientOperationGuard()).current;
  const mountedRef = useRef(true);
  const [snapshot, setSnapshot] = useState<ClientOperationSnapshot>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const syncSnapshot = useCallback(() => {
    if (mountedRef.current) setSnapshot(guard.snapshot());
  }, [guard]);
  const acquire = useCallback(
    (kind: ClientOperationKind) => {
      const token = guard.acquire(kind);
      if (token) syncSnapshot();
      return token;
    },
    [guard, syncSnapshot],
  );
  const release = useCallback(
    (token: ClientOperationToken) => {
      if (guard.release(token)) syncSnapshot();
    },
    [guard, syncSnapshot],
  );
  const markNavigating = useCallback(
    (token: ClientOperationToken) => {
      if (guard.markNavigating(token)) syncSnapshot();
    },
    [guard, syncSnapshot],
  );
  const isBusy = useCallback(() => guard.isBusy(), [guard]);
  const value = useMemo(
    () => ({
      snapshot,
      busy: snapshot !== null,
      acquire,
      release,
      markNavigating,
      isBusy,
    }),
    [snapshot, acquire, release, markNavigating, isBusy],
  );

  return (
    <TransactionOperationContext.Provider value={value}>
      {children}
    </TransactionOperationContext.Provider>
  );
}

export function useTransactionOperation() {
  const value = useContext(TransactionOperationContext);
  if (!value) {
    throw new Error("Transaction controls require TransactionOperationShell.");
  }
  return value;
}

export function TransactionOperationBackLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const operation = useTransactionOperation();
  const stopWhenBusy = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!operation.isBusy()) return;
    event.preventDefault();
  };

  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="-ml-3 mb-5"
      aria-disabled={operation.busy}
    >
      <Link
        href={href}
        onClick={stopWhenBusy}
        tabIndex={operation.busy ? -1 : undefined}
        className={
          operation.busy ? "pointer-events-none opacity-50" : undefined
        }
      >
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
        {children}
      </Link>
    </Button>
  );
}

export function TransactionCorrectionPanel({
  children,
}: {
  children: ReactNode;
}) {
  const operation = useTransactionOperation();
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="group mt-7 rounded-xl border bg-white shadow-sm">
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-start rounded-xl p-5 font-semibold text-primary-950 sm:p-6"
        onClick={() => {
          if (!operation.isBusy()) setExpanded((current) => !current);
        }}
        disabled={operation.busy}
        aria-expanded={expanded}
        aria-controls="transaction-correction-form"
      >
        <PencilLine
          className="mr-3 h-5 w-5 text-primary-700"
          aria-hidden="true"
        />
        Correct with a full replacement
        {!expanded ? (
          <span className="ml-auto text-sm font-normal text-muted-foreground">
            Expand
          </span>
        ) : null}
      </Button>
      {expanded ? (
        <div id="transaction-correction-form" className="border-t p-5 sm:p-8">
          {children}
        </div>
      ) : null}
    </section>
  );
}
