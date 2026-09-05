import type {
  EconomicEventKind,
  FeeMagnitude,
  InboundPositionMagnitude,
  RecordTransactionIntent,
} from "../services/portfolio-transactions/domain.ts";
import { toExplicitPortfolioTimestamp } from "./portfolio-transaction-ui.ts";

export type TransactionFormValues = {
  kind: EconomicEventKind;
  occurredLocal: string;
  note: string;
  actualValueUsd: string;
  positionMode: "existing" | "new";
  positionId: string;
  quantity: string;
  swapFromId: string;
  swapFromQuantity: string;
  swapToMode: "existing" | "new";
  swapToId: string;
  swapToQuantity: string;
  newAssetId: string;
  newAssetName: string;
  feeEnabled: boolean;
  feePositionId: string;
  feeQuantity: string;
  feeValueUsd: string;
};

export type TransactionFieldName = Exclude<
  keyof TransactionFormValues,
  "kind" | "feeEnabled"
>;
export type TransactionFieldErrors = Partial<
  Record<TransactionFieldName | "kind", string>
>;

export function feeEnabledAfterKindChange(
  previousKind: EconomicEventKind,
  nextKind: EconomicEventKind,
  currentFeeEnabled: boolean,
  rememberedOptionalFeeEnabled: boolean,
): boolean {
  if (nextKind === "FEE") return true;
  if (previousKind === "FEE") return rememberedOptionalFeeEnabled;
  return currentFeeEnabled;
}

const POSITIVE_DECIMAL = /^(?:0*[1-9]\d*(?:\.\d+)?|0*\.\d*[1-9]\d*)$/;

export function defaultTransactionFormValues(
  kind: EconomicEventKind,
  preferNewPosition: boolean,
  initialPositionId: string,
  initialOccurredLocal: string,
): TransactionFormValues {
  return {
    kind,
    occurredLocal: initialOccurredLocal,
    note: "",
    actualValueUsd: "",
    positionMode: preferNewPosition ? "new" : "existing",
    positionId: initialPositionId,
    quantity: "",
    swapFromId: initialPositionId,
    swapFromQuantity: "",
    swapToMode: preferNewPosition ? "new" : "existing",
    swapToId: "",
    swapToQuantity: "",
    newAssetId: "",
    newAssetName: "",
    feeEnabled: kind === "FEE",
    feePositionId: "",
    feeQuantity: "",
    feeValueUsd: "",
  };
}

function validatePositive(value: string, label: string, required = true) {
  const normalized = value.trim();
  if (!normalized && !required) return undefined;
  if (!POSITIVE_DECIMAL.test(normalized)) {
    return `${label} must be a positive decimal amount.`;
  }
  return undefined;
}

export function validateTransactionFormValues(
  values: TransactionFormValues,
): TransactionFieldErrors {
  const errors: TransactionFieldErrors = {};
  try {
    toExplicitPortfolioTimestamp(values.occurredLocal);
  } catch (error) {
    errors.occurredLocal =
      error instanceof Error ? error.message : "Choose a valid date and time.";
  }
  if (values.note.trim().length > 500) {
    errors.note = "Notes must be 500 characters or fewer.";
  }
  if (values.kind !== "FEE") {
    errors.actualValueUsd = validatePositive(
      values.actualValueUsd,
      "Actual USD value",
      false,
    );
  }

  if (values.kind === "SWAP") {
    if (!values.swapFromId) errors.swapFromId = "Choose the position sent.";
    errors.swapFromQuantity = validatePositive(
      values.swapFromQuantity,
      "Quantity sent",
    );
    errors.swapToQuantity = validatePositive(
      values.swapToQuantity,
      "Quantity received",
    );
    if (values.swapToMode === "existing") {
      if (!values.swapToId) errors.swapToId = "Choose the position received.";
      if (values.swapToId && values.swapToId === values.swapFromId) {
        errors.swapToId = "A swap needs two different positions.";
      }
    }
  } else if (values.kind !== "FEE") {
    errors.quantity = validatePositive(values.quantity, "Quantity");
    const inbound = values.kind === "BUY" || values.kind === "TRANSFER_IN";
    if (!inbound || values.positionMode === "existing") {
      if (!values.positionId) errors.positionId = "Choose a position.";
    }
  }

  const usesNewPosition =
    ((values.kind === "BUY" || values.kind === "TRANSFER_IN") &&
      values.positionMode === "new") ||
    (values.kind === "SWAP" && values.swapToMode === "new");
  if (usesNewPosition) {
    if (!values.newAssetId) errors.newAssetId = "Choose a coin.";
    const alias = values.newAssetName.trim();
    if (!alias || alias.length > 80) {
      errors.newAssetName = "Use an alias between 1 and 80 characters.";
    }
  }

  if (values.kind === "FEE" || values.feeEnabled) {
    if (!values.feePositionId) {
      errors.feePositionId = "Choose the position used for the fee.";
    }
    errors.feeQuantity = validatePositive(values.feeQuantity, "Fee quantity");
    errors.feeValueUsd = validatePositive(
      values.feeValueUsd,
      "Fee USD value",
      false,
    );
  }
  return Object.fromEntries(
    Object.entries(errors).filter(([, message]) => Boolean(message)),
  );
}

function inboundPosition(
  values: TransactionFormValues,
  mode: "existing" | "new",
  positionId: string,
  quantity: string,
): InboundPositionMagnitude {
  if (mode === "new") {
    return {
      newPosition: {
        assetId: values.newAssetId.trim(),
        assetName: values.newAssetName.trim(),
      },
      quantity: quantity.trim(),
    };
  }
  return { userAssetId: positionId, quantity: quantity.trim() };
}

function fee(values: TransactionFormValues): FeeMagnitude | null {
  if (values.kind !== "FEE" && !values.feeEnabled) return null;
  return {
    userAssetId: values.feePositionId,
    quantity: values.feeQuantity.trim(),
    valueUsd: values.feeValueUsd.trim() || null,
  };
}

export function buildTransactionIntent(
  values: TransactionFormValues,
  idempotencyKey: string,
): RecordTransactionIntent {
  const base = {
    occurredAt: toExplicitPortfolioTimestamp(values.occurredLocal),
    idempotencyKey,
    note: values.note.trim() || null,
  };
  const actualValueUsd = values.actualValueUsd.trim() || null;

  switch (values.kind) {
    case "BUY":
    case "TRANSFER_IN":
      return {
        ...base,
        kind: values.kind,
        actualValueUsd,
        position: inboundPosition(
          values,
          values.positionMode,
          values.positionId,
          values.quantity,
        ),
        fee: fee(values),
      };
    case "SELL":
    case "TRANSFER_OUT":
      return {
        ...base,
        kind: values.kind,
        actualValueUsd,
        position: {
          userAssetId: values.positionId,
          quantity: values.quantity.trim(),
        },
        fee: fee(values),
      };
    case "SWAP":
      return {
        ...base,
        kind: "SWAP",
        actualValueUsd,
        from: {
          userAssetId: values.swapFromId,
          quantity: values.swapFromQuantity.trim(),
        },
        to: inboundPosition(
          values,
          values.swapToMode,
          values.swapToId,
          values.swapToQuantity,
        ),
        fee: fee(values),
      };
    case "FEE":
      return {
        ...base,
        kind: "FEE",
        fee: fee(values) as FeeMagnitude,
      };
  }
}
