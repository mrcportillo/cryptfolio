"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { reversePortfolioTransaction } from "@/app/actions/portfolio-transaction";
import { useTransactionOperation } from "@/components/transactions/TransactionOperationShell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  createAsyncLifecycle,
  ensureStableValue,
} from "@/lib/client-operation-guard";

export default function TransactionReversal({ eventId }: { eventId: string }) {
  const router = useRouter();
  const operation = useTransactionOperation();
  const lifecycle = useRef(createAsyncLifecycle()).current;
  const requestLockRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error && errorRef.current?.isConnected) errorRef.current.focus();
  }, [error]);

  useEffect(() => {
    lifecycle.mount();
    return () => lifecycle.unmount();
  }, [lifecycle]);

  const reverse = async () => {
    if (requestLockRef.current || operation.isBusy()) return;
    const operationToken = operation.acquire("reverse");
    if (!operationToken) {
      setError("Another transaction operation is already in progress.");
      return;
    }
    requestLockRef.current = true;
    const generation = lifecycle.begin();
    const stableKey = ensureStableValue(idempotencyKeyRef, () =>
      crypto.randomUUID(),
    );
    setPending(true);
    setError(null);
    try {
      const result = await reversePortfolioTransaction(eventId, stableKey);
      if (result.ok === false) {
        operation.release(operationToken);
        requestLockRef.current = false;
        if (lifecycle.isCurrent(generation)) {
          setError(result.error);
          setPending(false);
        }
        return;
      }
      if (!lifecycle.isCurrent(generation)) {
        operation.release(operationToken);
        requestLockRef.current = false;
        return;
      }
      operation.markNavigating(operationToken);
      router.push(`/transactions/${result.eventIds[0]}`);
      router.refresh();
    } catch {
      operation.release(operationToken);
      requestLockRef.current = false;
      if (lifecycle.isCurrent(generation)) {
        setError(
          "The result is uncertain. Retry this reversal with the same safety key.",
        );
        setPending(false);
      }
    }
  };

  return (
    <div className="space-y-3">
      {error ? (
        <div
          ref={errorRef}
          tabIndex={-1}
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" disabled={pending || operation.busy}>
            <Undo2 className="mr-2 h-4 w-4" aria-hidden="true" />
            {pending ? "Reversing…" : "Reverse transaction"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Write a permanent reversal?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                Cryptfolio will retain the original and add an exact inverse at
                its original timestamp. This is not a delete.
              </span>
              <span className="block">
                The reversal can be rejected if later activity relies on the
                balance created by this event.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending || operation.busy}>
              Keep transaction
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={reverse}
              disabled={pending || operation.busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Write reversal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
