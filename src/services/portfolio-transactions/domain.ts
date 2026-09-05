import {
  addDecimals,
  canonicalDecimal,
  decimalToUnits,
  negateDecimal,
  positiveDecimal,
} from "./decimal.ts";

export const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const MAX_TRANSACTION_NOTE_LENGTH = 500;
const EXPLICIT_TIMEZONE_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-](\d{2}):(\d{2}))$/i;

export const ECONOMIC_EVENT_KINDS = [
  "BUY",
  "SELL",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "SWAP",
  "FEE",
] as const;

export type EconomicEventKind = (typeof ECONOMIC_EVENT_KINDS)[number];
export type LedgerEventKind =
  | "OPENING_BALANCE"
  | EconomicEventKind
  | "REVERSAL";
export type MovementRole = "PRINCIPAL" | "FEE";

export type PositionMagnitude = {
  userAssetId: string;
  quantity: string;
};

export type NewPositionMagnitude = {
  newPosition: {
    assetId: string;
    assetName: string;
  };
  quantity: string;
};

export type InboundPositionMagnitude = PositionMagnitude | NewPositionMagnitude;

export type FeeMagnitude = PositionMagnitude & {
  valueUsd?: string | null;
};

type TransactionBase = {
  occurredAt: Date | string;
  idempotencyKey: string;
  actualValueUsd?: string | null;
  note?: string | null;
};

export type RecordTransactionIntent =
  | (TransactionBase & {
      kind: "BUY" | "TRANSFER_IN";
      position: InboundPositionMagnitude;
      fee?: FeeMagnitude | null;
    })
  | (TransactionBase & {
      kind: "SELL" | "TRANSFER_OUT";
      position: PositionMagnitude;
      fee?: FeeMagnitude | null;
    })
  | (TransactionBase & {
      kind: "SWAP";
      from: PositionMagnitude;
      to: InboundPositionMagnitude;
      fee?: FeeMagnitude | null;
    })
  | (Omit<TransactionBase, "actualValueUsd"> & {
      kind: "FEE";
      fee: FeeMagnitude;
    });

export type ReplacementTransactionIntent =
  RecordTransactionIntent extends infer Intent
    ? Intent extends RecordTransactionIntent
      ? Omit<Intent, "idempotencyKey">
      : never
    : never;

export type ResolvedRecordTransactionIntent =
  | (TransactionBase & {
      kind: "BUY" | "SELL" | "TRANSFER_IN" | "TRANSFER_OUT";
      position: PositionMagnitude;
      fee?: FeeMagnitude | null;
    })
  | (TransactionBase & {
      kind: "SWAP";
      from: PositionMagnitude;
      to: PositionMagnitude;
      fee?: FeeMagnitude | null;
    })
  | (Omit<TransactionBase, "actualValueUsd"> & {
      kind: "FEE";
      fee: FeeMagnitude;
    });

export type LedgerMovementDraft = {
  userAssetId: string;
  role: MovementRole;
  quantityDelta: string;
  unitPriceUsd: string | null;
  priceEstimated: boolean;
};

export type LedgerEventDraft = {
  kind: LedgerEventKind;
  occurredAt: Date;
  actualValueUsd: string | null;
  externalFlowUsd: string | null;
  feeUsd: string | null;
  note: string | null;
  reversalOfEventId: string | null;
  replacementForEventId: string | null;
  movements: LedgerMovementDraft[];
};

export type StoredLedgerEvent = LedgerEventDraft & {
  id: string;
  userId: string;
  idempotencyKey: string;
  createdAt: Date;
};

export type TimelineMovement = {
  eventId: string;
  userAssetId: string;
  occurredAt: Date;
  quantityDelta: string;
};

export class LedgerValidationError extends Error {
  readonly code:
    | "INVALID_INPUT"
    | "NOT_ADOPTED"
    | "NOT_FOUND"
    | "NOT_OWNED"
    | "DUPLICATE_KEY"
    | "NEGATIVE_BALANCE"
    | "ALREADY_REVERSED"
    | "NOT_REVERSIBLE";

  constructor(
    message: string,
    code:
      | "INVALID_INPUT"
      | "NOT_ADOPTED"
      | "NOT_FOUND"
      | "NOT_OWNED"
      | "DUPLICATE_KEY"
      | "NEGATIVE_BALANCE"
      | "ALREADY_REVERSED"
      | "NOT_REVERSIBLE",
  ) {
    super(message);
    this.name = "LedgerValidationError";
    this.code = code;
  }
}

export function isEconomicEventKind(
  kind: LedgerEventKind,
): kind is EconomicEventKind {
  return (ECONOMIC_EVENT_KINDS as readonly string[]).includes(kind);
}

function invalid(message: string): never {
  throw new LedgerValidationError(message, "INVALID_INPUT");
}

function normalizeId(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(`${field} is required.`);
  const normalized = value.trim();
  if (!normalized) invalid(`${field} is required.`);
  return normalized;
}

export function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      normalized,
    )
  ) {
    invalid("Use a UUID idempotency key.");
  }
  return normalized;
}

export function correctionKeys(baseKey: string) {
  const normalized = normalizeIdempotencyKey(baseKey);
  return {
    reversal: `reverse:${normalized}`,
    replacement: `replace:${normalized}`,
  };
}

export function reversalKey(baseKey: string) {
  return `reverse:${normalizeIdempotencyKey(baseKey)}`;
}

function normalizeTimestamp(
  value: Date | string,
  adoptionAt: Date,
  now: Date,
): Date {
  let timestamp: Date;
  if (typeof value === "string") {
    const parts = EXPLICIT_TIMEZONE_TIMESTAMP.exec(value);
    if (!parts) {
      invalid("Use an ISO-8601 date and time with an explicit timezone.");
    }
    const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
      parts;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText ?? "0");
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [
      31,
      leapYear ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ][month - 1];
    if (
      daysInMonth === undefined ||
      day < 1 ||
      day > daysInMonth ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) {
      invalid("Choose a valid date and time.");
    }
    timestamp = new Date(value);
  } else {
    timestamp = new Date(value.getTime());
  }
  if (Number.isNaN(timestamp.getTime()))
    invalid("Choose a valid date and time.");
  if (timestamp.getTime() < adoptionAt.getTime()) {
    invalid("Transactions cannot be recorded before ledger adoption.");
  }
  if (timestamp.getTime() > now.getTime() + FUTURE_CLOCK_SKEW_MS) {
    invalid("Transactions cannot be materially in the future.");
  }
  return timestamp;
}

function normalizeNote(value: string | null | undefined): string | null {
  const note = value?.trim() || null;
  if (note && note.length > MAX_TRANSACTION_NOTE_LENGTH) {
    invalid(
      `Notes must be ${MAX_TRANSACTION_NOTE_LENGTH} characters or fewer.`,
    );
  }
  return note;
}

function normalizeOptionalUsd(
  value: string | null | undefined,
  field: string,
): string | null {
  if (value == null || value.trim() === "") return null;
  try {
    return positiveDecimal(value, field);
  } catch (error) {
    invalid(error instanceof Error ? error.message : `${field} is invalid.`);
  }
}

function movement(
  input: PositionMagnitude,
  role: MovementRole,
  sign: 1 | -1,
): LedgerMovementDraft {
  let quantity: string;
  try {
    quantity = positiveDecimal(input.quantity, "Quantity");
  } catch (error) {
    invalid(error instanceof Error ? error.message : "Quantity is invalid.");
  }

  return {
    userAssetId: normalizeId(input.userAssetId, "Position"),
    role,
    quantityDelta: sign === 1 ? quantity : negateDecimal(quantity),
    unitPriceUsd: null,
    priceEstimated: false,
  };
}

function normalizeFee(fee: FeeMagnitude | null | undefined): {
  movement: LedgerMovementDraft | null;
  valueUsd: string | null;
} {
  if (!fee) return { movement: null, valueUsd: "0" };
  return {
    movement: movement(fee, "FEE", -1),
    valueUsd: normalizeOptionalUsd(fee.valueUsd, "Fee value"),
  };
}

export function buildEventDraft(
  intent: ResolvedRecordTransactionIntent,
  adoptionAt: Date,
  now = new Date(),
): { idempotencyKey: string; event: LedgerEventDraft } {
  if (!(ECONOMIC_EVENT_KINDS as readonly string[]).includes(intent.kind)) {
    invalid("Opening balances and reversals cannot be entered manually.");
  }
  const idempotencyKey = normalizeIdempotencyKey(intent.idempotencyKey);
  const occurredAt = normalizeTimestamp(intent.occurredAt, adoptionAt, now);
  const note = normalizeNote(intent.note);
  const movements: LedgerMovementDraft[] = [];
  let actualValueUsd: string | null = null;
  let externalFlowUsd: string | null = null;
  let feeUsd: string | null = "0";

  if (intent.kind === "FEE") {
    const normalizedFee = normalizeFee(intent.fee);
    if (!normalizedFee.movement) invalid("A fee movement is required.");
    movements.push(normalizedFee.movement);
    feeUsd = normalizedFee.valueUsd;
    externalFlowUsd = "0";
  } else {
    actualValueUsd = normalizeOptionalUsd(
      intent.actualValueUsd,
      "Actual USD value",
    );
    const normalizedFee = normalizeFee(intent.fee);
    if (normalizedFee.movement) movements.push(normalizedFee.movement);
    feeUsd = normalizedFee.valueUsd;

    if (intent.kind === "SWAP") {
      if (intent.from.userAssetId.trim() === intent.to.userAssetId.trim()) {
        invalid("A swap needs two different positions.");
      }
      movements.unshift(
        movement(intent.from, "PRINCIPAL", -1),
        movement(intent.to, "PRINCIPAL", 1),
      );
      externalFlowUsd = "0";
    } else {
      const inbound = intent.kind === "BUY" || intent.kind === "TRANSFER_IN";
      movements.unshift(
        movement(intent.position, "PRINCIPAL", inbound ? 1 : -1),
      );
      externalFlowUsd = actualValueUsd
        ? inbound
          ? actualValueUsd
          : negateDecimal(actualValueUsd)
        : null;
    }
  }

  return {
    idempotencyKey,
    event: {
      kind: intent.kind,
      occurredAt,
      actualValueUsd,
      externalFlowUsd,
      feeUsd,
      note,
      reversalOfEventId: null,
      replacementForEventId: null,
      movements,
    },
  };
}

export function buildReversalDraft(
  original: StoredLedgerEvent,
): LedgerEventDraft {
  if (original.kind === "REVERSAL" || original.kind === "OPENING_BALANCE") {
    throw new LedgerValidationError(
      "Opening balances and reversals cannot be reversed.",
      "NOT_REVERSIBLE",
    );
  }

  return {
    kind: "REVERSAL",
    occurredAt: new Date(original.occurredAt),
    actualValueUsd: original.actualValueUsd
      ? negateDecimal(original.actualValueUsd)
      : null,
    externalFlowUsd: original.externalFlowUsd
      ? negateDecimal(original.externalFlowUsd)
      : null,
    feeUsd: original.feeUsd ? negateDecimal(original.feeUsd) : null,
    note: null,
    reversalOfEventId: original.id,
    replacementForEventId: null,
    movements: original.movements.map((source) => ({
      ...source,
      quantityDelta: negateDecimal(source.quantityDelta),
    })),
  };
}

export function eventSignature(event: LedgerEventDraft): string {
  return JSON.stringify({
    kind: event.kind,
    occurredAt: event.occurredAt.toISOString(),
    actualValueUsd: normalizeStoredDecimal(event.actualValueUsd),
    externalFlowUsd: normalizeStoredDecimal(event.externalFlowUsd),
    feeUsd: normalizeStoredDecimal(event.feeUsd),
    note: event.note,
    reversalOfEventId: event.reversalOfEventId,
    replacementForEventId: event.replacementForEventId,
    movements: event.movements
      .map((item) => ({
        userAssetId: item.userAssetId,
        role: item.role,
        quantityDelta: canonicalDecimal(item.quantityDelta),
        unitPriceUsd: normalizeStoredDecimal(item.unitPriceUsd),
        priceEstimated: item.priceEstimated,
      }))
      .sort((left, right) =>
        `${left.userAssetId}:${left.role}`.localeCompare(
          `${right.userAssetId}:${right.role}`,
        ),
      ),
  });
}

function normalizeStoredDecimal(value: string | null): string | null {
  return value == null ? null : canonicalDecimal(value);
}

export function assertIdempotentMatch(
  existing: StoredLedgerEvent,
  expected: LedgerEventDraft,
) {
  if (eventSignature(existing) !== eventSignature(expected)) {
    throw new LedgerValidationError(
      "That idempotency key was already used for a different transaction.",
      "DUPLICATE_KEY",
    );
  }
}

export function assertNonnegativeTimeline(
  rows: TimelineMovement[],
): Map<string, string> {
  const byPosition = new Map<string, TimelineMovement[]>();
  for (const row of rows) {
    const positionRows = byPosition.get(row.userAssetId) ?? [];
    positionRows.push(row);
    byPosition.set(row.userAssetId, positionRows);
  }

  const balances = new Map<string, string>();
  for (const [userAssetId, positionRows] of byPosition) {
    positionRows.sort(
      (left, right) =>
        left.occurredAt.getTime() - right.occurredAt.getTime() ||
        left.eventId.localeCompare(right.eventId),
    );

    let balance = "0";
    let index = 0;
    while (index < positionRows.length) {
      const boundary = positionRows[index].occurredAt.getTime();
      let boundaryDelta = "0";
      while (
        index < positionRows.length &&
        positionRows[index].occurredAt.getTime() === boundary
      ) {
        boundaryDelta = addDecimals(
          boundaryDelta,
          positionRows[index].quantityDelta,
        );
        index += 1;
      }
      balance = addDecimals(balance, boundaryDelta);
      if (decimalToUnits(balance) < BigInt(0)) {
        throw new LedgerValidationError(
          `Transaction history would make position ${userAssetId} negative at ${new Date(boundary).toISOString()}.`,
          "NEGATIVE_BALANCE",
        );
      }
    }
    balances.set(userAssetId, balance);
  }

  return balances;
}
