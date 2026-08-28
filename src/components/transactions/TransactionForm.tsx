"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  ReceiptText,
} from "lucide-react";
import {
  correctPortfolioTransaction,
  recordPortfolioTransaction,
} from "@/app/actions/portfolio-transaction";
import CoinPicker from "@/components/forms/CoinPicker";
import { useTransactionOperation } from "@/components/transactions/TransactionOperationShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createAsyncLifecycle,
  ensureStableDraftValue,
  scheduleInvalidFocus,
} from "@/lib/client-operation-guard";
import {
  buildTransactionIntent,
  defaultTransactionFormValues,
  feeEnabledAfterKindChange,
  validateTransactionFormValues,
  type TransactionFieldErrors,
  type TransactionFormValues,
} from "@/lib/portfolio-transaction-intent";
import {
  PORTFOLIO_TIME_ZONE,
  TRANSACTION_KIND_OPTIONS,
  formatExactDecimal,
  transactionKindLabel,
} from "@/lib/portfolio-transaction-ui";
import type { EconomicEventKind } from "@/services/portfolio-transactions/domain";
import type { TransactionPositionCatalogItem } from "@/services/portfolio-transactions/queries";
import type { CoinOption } from "@/types/coin";
import { cn } from "@/lib/utils";

type PositionOption = Omit<TransactionPositionCatalogItem, "archivedAt"> & {
  archivedAt: string | null;
};

type FieldErrors = TransactionFieldErrors;

type TransactionFormProps = {
  positions: PositionOption[];
  coinOptions: CoinOption[];
  coinLoadError?: string;
  initialKind?: EconomicEventKind;
  initialOccurredLocal?: string;
  initialPositionId?: string;
  preferNewPosition?: boolean;
  correction?: {
    eventId: string;
    initialValues: TransactionFormValues;
  };
  cancelHref?: string;
};

const KIND_ICONS: Record<EconomicEventKind, ReactNode> = {
  BUY: <ArrowDownLeft className="h-4 w-4" aria-hidden="true" />,
  SELL: <ArrowUpRight className="h-4 w-4" aria-hidden="true" />,
  TRANSFER_IN: <ArrowDownLeft className="h-4 w-4" aria-hidden="true" />,
  TRANSFER_OUT: <ArrowUpRight className="h-4 w-4" aria-hidden="true" />,
  SWAP: <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />,
  FEE: <ReceiptText className="h-4 w-4" aria-hidden="true" />,
};

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-destructive" role="alert">
      {message}
    </p>
  );
}

function describedBy(...ids: Array<string | false | undefined>) {
  const value = ids.filter(Boolean).join(" ");
  return value || undefined;
}

function PositionSelect({
  id,
  label,
  value,
  onChange,
  options,
  error,
  hint,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: PositionOption[];
  error?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-describedby={describedBy(hint && hintId, error && errorId)}
        aria-invalid={Boolean(error)}
        disabled={disabled}
        required
      >
        <option value="">Choose a position</option>
        {options.map((position) => (
          <option key={position.id} value={position.id}>
            {position.assetName} · {position.assetId} ·{" "}
            {formatExactDecimal(position.balance)}
            {position.archivedAt ? " · archived" : ""}
          </option>
        ))}
      </select>
      {hint ? (
        <p id={hintId} className="text-xs leading-5 text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function DecimalField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  required = true,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={required ? "0.00" : "Leave blank if unknown"}
        aria-describedby={describedBy(hint && hintId, error && errorId)}
        aria-invalid={Boolean(error)}
        disabled={disabled}
        required={required}
      />
      {hint ? (
        <p id={hintId} className="text-xs leading-5 text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function destinationLegend(kind: EconomicEventKind) {
  if (kind === "BUY") return "Crypto received";
  if (kind === "TRANSFER_IN") return "Incoming position";
  return "Position and quantity";
}

function actualValueLabel(kind: EconomicEventKind) {
  if (kind === "BUY") return "Amount paid outside portfolio (USD)";
  if (kind === "SELL") return "Proceeds received outside portfolio (USD)";
  if (kind === "SWAP") return "Actual trade value (USD)";
  return "External value (USD)";
}

export default function TransactionForm({
  positions,
  coinOptions,
  coinLoadError,
  initialKind = "BUY",
  initialOccurredLocal = "",
  initialPositionId = "",
  preferNewPosition = false,
  correction,
  cancelHref = "/transactions",
}: TransactionFormProps) {
  const router = useRouter();
  const operation = useTransactionOperation();
  const lifecycle = useRef(createAsyncLifecycle()).current;
  const submitLockRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const idempotencySignatureRef = useRef<string | null>(null);
  const invalidFocusCancelRef = useRef<(() => void) | null>(null);
  const [values, setValues] = useState<TransactionFormValues>(() =>
    correction
      ? correction.initialValues
      : defaultTransactionFormValues(
          initialKind,
          preferNewPosition,
          initialPositionId,
          initialOccurredLocal,
        ),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [ambiguousFailure, setAmbiguousFailure] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const optionalFeeEnabledRef = useRef(
    values.kind === "FEE" ? false : values.feeEnabled,
  );

  useEffect(() => {
    if (serverError && errorRef.current?.isConnected) {
      errorRef.current.focus();
    }
  }, [serverError]);

  useEffect(() => {
    lifecycle.mount();
    return () => {
      lifecycle.unmount();
      invalidFocusCancelRef.current?.();
    };
  }, [lifecycle]);

  const set = <Key extends keyof TransactionFormValues>(
    key: Key,
    value: TransactionFormValues[Key],
  ) => {
    if (submitLockRef.current || operation.isBusy() || ambiguousFailure) return;
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const correctionMode = Boolean(correction);
  const spendablePositions = correctionMode
    ? positions
    : positions.filter((position) => position.canSpend);
  const inboundKind = values.kind === "BUY" || values.kind === "TRANSFER_IN";
  const showOptionalFee = values.kind !== "FEE";
  const controlsDisabled = pending || operation.busy || ambiguousFailure;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (submitLockRef.current || operation.isBusy()) return;
    invalidFocusCancelRef.current?.();
    invalidFocusCancelRef.current = null;
    setServerError(null);
    const nextErrors = validateTransactionFormValues(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      invalidFocusCancelRef.current = scheduleInvalidFocus(
        form,
        lifecycle.isMounted,
        requestAnimationFrame,
        cancelAnimationFrame,
      );
      return;
    }

    const operationToken = operation.acquire(correction ? "correct" : "record");
    if (!operationToken) {
      setServerError("Another transaction operation is already in progress.");
      return;
    }
    submitLockRef.current = true;
    const generation = lifecycle.begin();
    const stableKey = ensureStableDraftValue(
      idempotencyKeyRef,
      idempotencySignatureRef,
      JSON.stringify(values),
      () => crypto.randomUUID(),
    );
    setPending(true);
    setAmbiguousFailure(false);
    try {
      const intent = buildTransactionIntent(values, stableKey);
      const result = correction
        ? await correctPortfolioTransaction({
            eventId: correction.eventId,
            idempotencyKey: stableKey,
            replacement: (() => {
              const { idempotencyKey: _key, ...replacement } = intent;
              return replacement;
            })(),
          })
        : await recordPortfolioTransaction(intent);
      if (result.ok === false) {
        operation.release(operationToken);
        submitLockRef.current = false;
        if (lifecycle.isCurrent(generation)) {
          setServerError(result.error);
          setPending(false);
        }
        return;
      }
      if (!lifecycle.isCurrent(generation)) {
        operation.release(operationToken);
        submitLockRef.current = false;
        return;
      }
      operation.markNavigating(operationToken);
      const destinationId = result.eventIds.at(-1);
      router.push(
        destinationId ? `/transactions/${destinationId}` : "/transactions",
      );
      router.refresh();
    } catch {
      operation.release(operationToken);
      submitLockRef.current = false;
      if (lifecycle.isCurrent(generation)) {
        setServerError(
          "The result is uncertain. This draft is locked; retry it unchanged with the same safety key, or cancel.",
        );
        setAmbiguousFailure(true);
        setPending(false);
      }
    }
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-8"
      aria-busy={pending}
      noValidate
    >
      <div
        className="rounded-lg border border-primary-200 bg-primary-50/70 p-4 text-sm leading-6 text-primary-950"
        role="note"
      >
        Enter positive magnitudes. Cryptfolio assigns inflow and outflow signs
        when it writes the ledger, so a sell of 0.2 BTC is entered as
        <span className="mx-1 font-mono font-semibold tabular-nums">0.2</span>
        here and stored as an outgoing movement.
      </div>

      {correctionMode ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <strong>Permanent correction pair.</strong> Saving writes an exact
          reversal of the original and this complete replacement together. The
          original is retained as evidence.
        </div>
      ) : null}

      {serverError ? (
        <div
          ref={errorRef}
          tabIndex={-1}
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring"
          role="alert"
        >
          {serverError}
        </div>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold uppercase tracking-[0.14em] text-primary-950">
          Transaction type
        </legend>
        {correctionMode ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-medium text-primary-950">
            {KIND_ICONS[values.kind]}
            {transactionKindLabel(values.kind)}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {TRANSACTION_KIND_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                  controlsDisabled && "cursor-not-allowed opacity-60",
                  values.kind === option.value
                    ? "border-primary-500 bg-primary-50"
                    : "bg-white hover:border-primary-300",
                )}
              >
                <input
                  type="radio"
                  name="kind"
                  value={option.value}
                  checked={values.kind === option.value}
                  onChange={() => {
                    if (values.kind !== "FEE") {
                      optionalFeeEnabledRef.current = values.feeEnabled;
                    }
                    set("kind", option.value);
                    set(
                      "feeEnabled",
                      feeEnabledAfterKindChange(
                        values.kind,
                        option.value,
                        values.feeEnabled,
                        optionalFeeEnabledRef.current,
                      ),
                    );
                  }}
                  disabled={controlsDisabled}
                  className="mt-1"
                />
                <span>
                  <span className="flex items-center gap-2 font-medium text-primary-950">
                    {KIND_ICONS[option.value]}
                    {option.label}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="grid gap-5 border-l-2 border-primary-200 pl-4 sm:grid-cols-2 sm:pl-6">
        <legend className="-ml-4 mb-3 px-4 text-sm font-semibold uppercase tracking-[0.14em] text-primary-950 sm:-ml-6 sm:px-6">
          When
        </legend>
        <div className="grid gap-2 sm:col-span-1">
          <Label htmlFor="occurred-local">Local date and time</Label>
          <Input
            id="occurred-local"
            type="datetime-local"
            step="0.001"
            value={values.occurredLocal}
            onChange={(event) => set("occurredLocal", event.target.value)}
            disabled={controlsDisabled}
            aria-describedby={describedBy(
              "occurred-local-hint",
              errors.occurredLocal && "occurred-local-error",
            )}
            aria-invalid={Boolean(errors.occurredLocal)}
            required
          />
          <p
            id="occurred-local-hint"
            className="text-xs leading-5 text-muted-foreground"
          >
            Interpreted in {PORTFOLIO_TIME_ZONE} (UTC−03:00) and submitted with
            that explicit offset.
          </p>
          <FieldError
            id="occurred-local-error"
            message={errors.occurredLocal}
          />
        </div>
      </fieldset>

      {values.kind === "SWAP" ? (
        <fieldset className="grid gap-6 border-l-2 border-primary-200 pl-4 sm:grid-cols-2 sm:pl-6">
          <legend className="-ml-4 mb-3 px-4 text-sm font-semibold uppercase tracking-[0.14em] text-primary-950 sm:-ml-6 sm:px-6">
            Exchange
          </legend>
          <div className="space-y-4 rounded-lg border bg-white p-4">
            <h3 className="font-medium text-primary-950">You sent</h3>
            <PositionSelect
              id="swap-from-position"
              label="Source position"
              value={values.swapFromId}
              onChange={(value) => set("swapFromId", value)}
              options={spendablePositions}
              error={errors.swapFromId}
              disabled={controlsDisabled}
              hint={
                correctionMode
                  ? "The reversal and replacement are balance-checked together, so the original source remains available."
                  : "Only a position with a spendable balance can fund a new swap."
              }
            />
            <DecimalField
              id="swap-from-quantity"
              label="Quantity sent"
              value={values.swapFromQuantity}
              onChange={(value) => set("swapFromQuantity", value)}
              error={errors.swapFromQuantity}
              disabled={controlsDisabled}
            />
          </div>
          <div className="space-y-4 rounded-lg border bg-white p-4">
            <h3 className="font-medium text-primary-950">You received</h3>
            <InboundFields
              prefix="swap-to"
              mode={values.swapToMode}
              setMode={(value) => set("swapToMode", value)}
              positionId={values.swapToId}
              setPositionId={(value) => set("swapToId", value)}
              quantity={values.swapToQuantity}
              setQuantity={(value) => set("swapToQuantity", value)}
              positions={positions}
              coinOptions={coinOptions}
              coinLoadError={coinLoadError}
              newAssetId={values.newAssetId}
              setNewAssetId={(value) => set("newAssetId", value)}
              newAssetName={values.newAssetName}
              setNewAssetName={(value) => set("newAssetName", value)}
              errors={errors}
              disabled={controlsDisabled}
            />
          </div>
        </fieldset>
      ) : values.kind !== "FEE" ? (
        <fieldset className="space-y-5 border-l-2 border-primary-200 pl-4 sm:pl-6">
          <legend className="-ml-4 mb-3 px-4 text-sm font-semibold uppercase tracking-[0.14em] text-primary-950 sm:-ml-6 sm:px-6">
            {destinationLegend(values.kind)}
          </legend>
          {inboundKind ? (
            <InboundFields
              prefix="position"
              mode={values.positionMode}
              setMode={(value) => set("positionMode", value)}
              positionId={values.positionId}
              setPositionId={(value) => set("positionId", value)}
              quantity={values.quantity}
              setQuantity={(value) => set("quantity", value)}
              positions={positions}
              coinOptions={coinOptions}
              coinLoadError={coinLoadError}
              newAssetId={values.newAssetId}
              setNewAssetId={(value) => set("newAssetId", value)}
              newAssetName={values.newAssetName}
              setNewAssetName={(value) => set("newAssetName", value)}
              errors={errors}
              disabled={controlsDisabled}
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              <PositionSelect
                id="position"
                label="Position"
                value={values.positionId}
                onChange={(value) => set("positionId", value)}
                options={spendablePositions}
                error={errors.positionId}
                disabled={controlsDisabled}
                hint={
                  correctionMode
                    ? "The reversal and replacement are balance-checked together, so the original source remains available."
                    : "Only a position with a spendable balance can fund a new outgoing transaction."
                }
              />
              <DecimalField
                id="quantity"
                label="Quantity"
                value={values.quantity}
                onChange={(value) => set("quantity", value)}
                error={errors.quantity}
                disabled={controlsDisabled}
              />
            </div>
          )}
        </fieldset>
      ) : null}

      {values.kind !== "FEE" ? (
        <fieldset className="grid gap-5 border-l-2 border-primary-200 pl-4 sm:grid-cols-2 sm:pl-6">
          <legend className="-ml-4 mb-3 px-4 text-sm font-semibold uppercase tracking-[0.14em] text-primary-950 sm:-ml-6 sm:px-6">
            Value
          </legend>
          <DecimalField
            id="actual-value-usd"
            label={actualValueLabel(values.kind)}
            value={values.actualValueUsd}
            onChange={(value) => set("actualValueUsd", value)}
            error={errors.actualValueUsd}
            hint={
              values.kind === "SWAP"
                ? "Optional context only. A swap never counts as external cash flow."
                : "Optional. Leave blank when the actual USD amount is unknown; it will remain unvalued, never zero."
            }
            required={false}
            disabled={controlsDisabled}
          />
        </fieldset>
      ) : null}

      <fieldset className="space-y-5 border-l-2 border-primary-200 pl-4 sm:pl-6">
        <legend className="-ml-4 mb-3 px-4 text-sm font-semibold uppercase tracking-[0.14em] text-primary-950 sm:-ml-6 sm:px-6">
          Fee paid in crypto
        </legend>
        {showOptionalFee ? (
          <label className="flex max-w-xl items-start gap-3 rounded-lg border bg-white p-4 text-sm">
            <input
              type="checkbox"
              checked={values.feeEnabled}
              onChange={(event) => {
                optionalFeeEnabledRef.current = event.target.checked;
                set("feeEnabled", event.target.checked);
              }}
              disabled={controlsDisabled}
              className="mt-1"
            />
            <span>
              <span className="font-medium text-primary-950">
                Include a tracked crypto fee
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Fiat fees and exchange cash balances are outside this personal
                ledger.
              </span>
            </span>
          </label>
        ) : (
          <p className="text-sm text-muted-foreground">
            Record the crypto quantity deducted and its actual USD value if
            known.
          </p>
        )}
        {values.kind === "FEE" || values.feeEnabled ? (
          <div className="grid gap-5 sm:grid-cols-3">
            <PositionSelect
              id="fee-position"
              label="Fee position"
              value={values.feePositionId}
              onChange={(value) => set("feePositionId", value)}
              options={spendablePositions}
              error={errors.feePositionId}
              disabled={controlsDisabled}
            />
            <DecimalField
              id="fee-quantity"
              label="Fee quantity"
              value={values.feeQuantity}
              onChange={(value) => set("feeQuantity", value)}
              error={errors.feeQuantity}
              disabled={controlsDisabled}
            />
            <DecimalField
              id="fee-value-usd"
              label="Actual fee value (USD)"
              value={values.feeValueUsd}
              onChange={(value) => set("feeValueUsd", value)}
              error={errors.feeValueUsd}
              hint="Leave blank if unknown."
              required={false}
              disabled={controlsDisabled}
            />
          </div>
        ) : null}
      </fieldset>

      <fieldset className="space-y-3 border-l-2 border-primary-200 pl-4 sm:pl-6">
        <legend className="-ml-4 mb-3 px-4 text-sm font-semibold uppercase tracking-[0.14em] text-primary-950 sm:-ml-6 sm:px-6">
          Note
        </legend>
        <Label htmlFor="transaction-note">Personal context (optional)</Label>
        <textarea
          id="transaction-note"
          value={values.note}
          onChange={(event) => set("note", event.target.value)}
          maxLength={500}
          rows={4}
          disabled={controlsDisabled}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          placeholder="Wallet, exchange, or why this movement matters…"
          aria-describedby={describedBy(
            "note-count",
            errors.note && "note-error",
          )}
          aria-invalid={Boolean(errors.note)}
        />
        <div className="flex justify-between gap-4 text-xs text-muted-foreground">
          <span>Stored with the event, not sent to a pricing service.</span>
          <span id="note-count" className="tabular-nums">
            {values.note.length}/500
          </span>
        </div>
        <FieldError id="note-error" message={errors.note} />
      </fieldset>

      <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (!submitLockRef.current && !operation.isBusy()) {
              router.push(cancelHref);
            }
          }}
          disabled={pending || operation.busy}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={pending || operation.busy}
          aria-busy={pending}
        >
          {pending
            ? correctionMode
              ? "Writing correction…"
              : "Recording…"
            : correctionMode
              ? "Reverse and replace"
              : "Record transaction"}
        </Button>
      </div>
    </form>
  );
}

function InboundFields({
  prefix,
  mode,
  setMode,
  positionId,
  setPositionId,
  quantity,
  setQuantity,
  positions,
  coinOptions,
  coinLoadError,
  newAssetId,
  setNewAssetId,
  newAssetName,
  setNewAssetName,
  errors,
  disabled,
}: {
  prefix: "position" | "swap-to";
  mode: "existing" | "new";
  setMode: (value: "existing" | "new") => void;
  positionId: string;
  setPositionId: (value: string) => void;
  quantity: string;
  setQuantity: (value: string) => void;
  positions: PositionOption[];
  coinOptions: CoinOption[];
  coinLoadError?: string;
  newAssetId: string;
  setNewAssetId: (value: string) => void;
  newAssetName: string;
  setNewAssetName: (value: string) => void;
  errors: FieldErrors;
  disabled: boolean;
}) {
  const positionError =
    prefix === "position" ? errors.positionId : errors.swapToId;
  const quantityError =
    prefix === "position" ? errors.quantity : errors.swapToQuantity;
  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-primary-950">
          Destination
        </legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`${prefix}-mode`}
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
              disabled={disabled}
            />
            Existing position
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`${prefix}-mode`}
              checked={mode === "new"}
              onChange={() => setMode("new")}
              disabled={
                disabled || Boolean(coinLoadError) || coinOptions.length === 0
              }
            />
            New coin position
          </label>
        </div>
      </fieldset>
      {mode === "existing" ? (
        <PositionSelect
          id={`${prefix}-existing`}
          label="Receiving position"
          value={positionId}
          onChange={setPositionId}
          options={positions}
          error={positionError}
          disabled={disabled}
          hint="Zero-balance and archived positions remain available as inbound destinations."
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {coinLoadError ? (
            <p className="text-sm text-destructive sm:col-span-2" role="alert">
              {coinLoadError}
            </p>
          ) : null}
          <CoinPicker
            name={`${prefix}-new-coin`}
            label="Coin"
            options={coinOptions}
            value={newAssetId}
            onValueChange={setNewAssetId}
            error={errors.newAssetId}
            disabled={disabled}
          />
          <div className="grid content-start gap-2">
            <Label htmlFor={`${prefix}-new-alias`}>Position alias</Label>
            <Input
              id={`${prefix}-new-alias`}
              value={newAssetName}
              onChange={(event) => setNewAssetName(event.target.value)}
              maxLength={80}
              disabled={disabled}
              aria-describedby={
                errors.newAssetName ? "new-asset-name-error" : undefined
              }
              aria-invalid={Boolean(errors.newAssetName)}
              placeholder="Long-term BTC"
              required
            />
            <FieldError
              id="new-asset-name-error"
              message={errors.newAssetName}
            />
          </div>
        </div>
      )}
      <DecimalField
        id={`${prefix}-quantity`}
        label="Quantity received"
        value={quantity}
        onChange={setQuantity}
        error={quantityError}
        disabled={disabled}
      />
    </div>
  );
}
