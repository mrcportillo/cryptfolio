import { createHash } from "node:crypto";
import {
  assertIdempotentMatch,
  assertNonnegativeTimeline,
  buildEventDraft,
  buildReversalDraft,
  correctionKeys,
  isEconomicEventKind,
  LedgerValidationError,
  normalizeIdempotencyKey,
  reversalKey,
  type FeeMagnitude,
  type InboundPositionMagnitude,
  type LedgerEventDraft,
  type PositionMagnitude,
  type RecordTransactionIntent,
  type ReplacementTransactionIntent,
  type ResolvedRecordTransactionIntent,
  type StoredLedgerEvent,
  type TimelineMovement,
} from "./domain.ts";
import { decimalToUnits } from "./decimal.ts";

export type LedgerUser = {
  id: string;
  ledgerAdoptedAt: Date | null;
};

export type LedgerPosition = {
  id: string;
  userId: string;
  assetId: string;
  assetName: string;
  ledgerInitialAssetName: string | null;
  archivedAt: Date | null;
};

export type LedgerPositionSeed = {
  id: string;
  assetId: string;
  assetName: string;
};

export type PortfolioTransactionStore<Transaction> = {
  runSerializable<T>(
    operation: (transaction: Transaction) => Promise<T>,
  ): Promise<T>;
  lockUser(
    transaction: Transaction,
    userId: string,
  ): Promise<LedgerUser | null>;
  findOwnedPositions(
    transaction: Transaction,
    userId: string,
    ids: string[],
  ): Promise<LedgerPosition[]>;
  createPosition(
    transaction: Transaction,
    input: {
      userId: string;
      seed: LedgerPositionSeed;
      archivedAt: Date;
    },
  ): Promise<LedgerPosition>;
  findOwnedEvent(
    transaction: Transaction,
    userId: string,
    eventId: string,
  ): Promise<StoredLedgerEvent | null>;
  findOwnedEventByKey(
    transaction: Transaction,
    userId: string,
    idempotencyKey: string,
  ): Promise<StoredLedgerEvent | null>;
  findReversalFor(
    transaction: Transaction,
    userId: string,
    eventId: string,
  ): Promise<StoredLedgerEvent | null>;
  createEvent(
    transaction: Transaction,
    input: {
      userId: string;
      idempotencyKey: string;
      event: LedgerEventDraft;
    },
  ): Promise<StoredLedgerEvent>;
  getTimeline(
    transaction: Transaction,
    userId: string,
    positionIds: string[],
  ): Promise<TimelineMovement[]>;
  setArchivedAt(
    transaction: Transaction,
    userId: string,
    positionId: string,
    archivedAt: Date | null,
  ): Promise<void>;
  flushLedgerConstraints(transaction: Transaction): Promise<void>;
};

export type CorrectionInput = {
  eventId: string;
  idempotencyKey: string;
  replacement: ReplacementTransactionIntent;
};

function uniquePositionIds(event: LedgerEventDraft): string[] {
  return Array.from(
    new Set(event.movements.map(({ userAssetId }) => userAssetId)),
  );
}

type PreparedIntent = {
  intent: ResolvedRecordTransactionIntent;
  newPositions: LedgerPositionSeed[];
  requiredExistingPositionIds: string[];
};

const COIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_COIN_ID_LENGTH = 160;
const MAX_ASSET_NAME_LENGTH = 80;

export function deterministicPositionId(
  userId: string,
  scopedIdempotencyKey: string,
  slot: string,
) {
  const digest = createHash("sha256")
    .update(
      `${userId.length}:${userId}|${scopedIdempotencyKey.length}:${scopedIdempotencyKey}|${slot.length}:${slot}`,
      "utf8",
    )
    .digest("hex");
  return `ledger-position:${digest.slice(0, 40)}`;
}

function normalizeNewPosition(
  value: unknown,
  userId: string,
  scopedIdempotencyKey: string,
  slot: string,
): LedgerPositionSeed {
  if (!value || typeof value !== "object") {
    throw new LedgerValidationError(
      "Choose an existing position or enter a new coin and alias.",
      "INVALID_INPUT",
    );
  }
  const candidate = value as { assetId?: unknown; assetName?: unknown };
  const assetId =
    typeof candidate.assetId === "string" ? candidate.assetId.trim() : "";
  const assetName =
    typeof candidate.assetName === "string" ? candidate.assetName.trim() : "";
  if (
    !assetId ||
    assetId.length > MAX_COIN_ID_LENGTH ||
    !COIN_ID_PATTERN.test(assetId)
  ) {
    throw new LedgerValidationError("Choose a valid coin.", "INVALID_INPUT");
  }
  if (!assetName || assetName.length > MAX_ASSET_NAME_LENGTH) {
    throw new LedgerValidationError(
      `Use an alias between 1 and ${MAX_ASSET_NAME_LENGTH} characters.`,
      "INVALID_INPUT",
    );
  }
  return {
    id: deterministicPositionId(userId, scopedIdempotencyKey, slot),
    assetId,
    assetName,
  };
}

function existingMagnitude(value: unknown, field: string): PositionMagnitude {
  if (!value || typeof value !== "object") {
    throw new LedgerValidationError(`${field} is required.`, "INVALID_INPUT");
  }
  const candidate = value as { userAssetId?: unknown; quantity?: unknown };
  if (
    typeof candidate.userAssetId !== "string" ||
    !candidate.userAssetId.trim() ||
    typeof candidate.quantity !== "string"
  ) {
    throw new LedgerValidationError(
      `${field} must use an existing position.`,
      "INVALID_INPUT",
    );
  }
  return {
    userAssetId: candidate.userAssetId.trim(),
    quantity: candidate.quantity,
  };
}

function inboundMagnitude(
  value: InboundPositionMagnitude,
  userId: string,
  scopedIdempotencyKey: string,
  slot: string,
): { magnitude: PositionMagnitude; seed: LedgerPositionSeed | null } {
  if (
    value &&
    typeof value === "object" &&
    "newPosition" in value &&
    value.newPosition != null
  ) {
    if ("userAssetId" in value && value.userAssetId) {
      throw new LedgerValidationError(
        "Choose either an existing position or a new one, not both.",
        "INVALID_INPUT",
      );
    }
    const seed = normalizeNewPosition(
      value.newPosition,
      userId,
      scopedIdempotencyKey,
      slot,
    );
    return {
      magnitude: { userAssetId: seed.id, quantity: value.quantity },
      seed,
    };
  }
  return {
    magnitude: existingMagnitude(value, "Position"),
    seed: null,
  };
}

function prepareIntent(
  intent: RecordTransactionIntent,
  userId: string,
  scopedIdempotencyKey: string,
): PreparedIntent {
  const newPositions: LedgerPositionSeed[] = [];
  const requiredExistingPositionIds: string[] = [];
  const requireExisting = (value: unknown, field: string) => {
    const magnitude = existingMagnitude(value, field);
    requiredExistingPositionIds.push(magnitude.userAssetId.trim());
    return magnitude;
  };
  const fee = (value: FeeMagnitude | null | undefined) =>
    value
      ? ({
          ...requireExisting(value, "Fee position"),
          valueUsd: value.valueUsd,
        } as FeeMagnitude)
      : value;

  if (intent.kind === "BUY" || intent.kind === "TRANSFER_IN") {
    const target = inboundMagnitude(
      intent.position,
      userId,
      scopedIdempotencyKey,
      "principal",
    );
    if (target.seed) newPositions.push(target.seed);
    return {
      intent: { ...intent, position: target.magnitude, fee: fee(intent.fee) },
      newPositions,
      requiredExistingPositionIds,
    };
  }
  if (intent.kind === "SELL" || intent.kind === "TRANSFER_OUT") {
    return {
      intent: {
        ...intent,
        position: requireExisting(intent.position, "Position"),
        fee: fee(intent.fee),
      },
      newPositions,
      requiredExistingPositionIds,
    };
  }
  if (intent.kind === "SWAP") {
    const target = inboundMagnitude(
      intent.to,
      userId,
      scopedIdempotencyKey,
      "swap-destination",
    );
    if (target.seed) newPositions.push(target.seed);
    return {
      intent: {
        ...intent,
        from: requireExisting(intent.from, "Swap source"),
        to: target.magnitude,
        fee: fee(intent.fee),
      },
      newPositions,
      requiredExistingPositionIds,
    };
  }
  if (intent.kind === "FEE") {
    return {
      intent: { ...intent, fee: fee(intent.fee) as FeeMagnitude },
      newPositions,
      requiredExistingPositionIds,
    };
  }
  throw new LedgerValidationError(
    "Opening balances and reversals cannot be entered manually.",
    "INVALID_INPUT",
  );
}

async function requireAdoptedUser<Transaction>(
  store: PortfolioTransactionStore<Transaction>,
  transaction: Transaction,
  userId: string,
) {
  const user = await store.lockUser(transaction, userId);
  if (!user) {
    throw new LedgerValidationError("Portfolio owner not found.", "NOT_FOUND");
  }
  if (!user.ledgerAdoptedAt) {
    throw new LedgerValidationError(
      "Adopt the transaction ledger before recording activity.",
      "NOT_ADOPTED",
    );
  }
  return user as LedgerUser & { ledgerAdoptedAt: Date };
}

async function requireOwnedPositions<Transaction>(
  store: PortfolioTransactionStore<Transaction>,
  transaction: Transaction,
  userId: string,
  ids: string[],
) {
  const uniqueIds = Array.from(new Set(ids));
  const positions = await store.findOwnedPositions(
    transaction,
    userId,
    uniqueIds,
  );
  if (positions.length !== uniqueIds.length) {
    throw new LedgerValidationError(
      "One or more positions do not belong to this portfolio.",
      "NOT_OWNED",
    );
  }
  return positions;
}

async function requirePositiveOwnedPositions<Transaction>(
  store: PortfolioTransactionStore<Transaction>,
  transaction: Transaction,
  userId: string,
  ids: string[],
) {
  const uniqueIds = Array.from(new Set(ids));
  await requireOwnedPositions(store, transaction, userId, uniqueIds);
  if (uniqueIds.length === 0) return;

  const balances = assertNonnegativeTimeline(
    await store.getTimeline(transaction, userId, uniqueIds),
  );
  for (const positionId of uniqueIds) {
    if (decimalToUnits(balances.get(positionId) ?? "0") <= BigInt(0)) {
      throw new LedgerValidationError(
        `Position ${positionId} must have a positive balance before it can fund an outgoing or fee movement.`,
        "NEGATIVE_BALANCE",
      );
    }
  }
}

function assertPositionSeedMatches(
  position: LedgerPosition,
  seed: LedgerPositionSeed,
) {
  if (
    position.assetId !== seed.assetId ||
    (position.ledgerInitialAssetName ?? position.assetName) !== seed.assetName
  ) {
    throw new LedgerValidationError(
      "That idempotency key resolves to a different coin or alias.",
      "DUPLICATE_KEY",
    );
  }
}

async function validateExistingPositionSeeds<Transaction>(
  store: PortfolioTransactionStore<Transaction>,
  transaction: Transaction,
  userId: string,
  seeds: LedgerPositionSeed[],
) {
  if (seeds.length === 0) return;
  const positions = await store.findOwnedPositions(
    transaction,
    userId,
    seeds.map(({ id }) => id),
  );
  const byId = new Map(positions.map((position) => [position.id, position]));
  for (const seed of seeds) {
    const position = byId.get(seed.id);
    if (!position) {
      throw new LedgerValidationError(
        "That idempotent transaction is missing its deterministic position.",
        "DUPLICATE_KEY",
      );
    }
    assertPositionSeedMatches(position, seed);
  }
}

async function ensurePositionSeeds<Transaction>(
  store: PortfolioTransactionStore<Transaction>,
  transaction: Transaction,
  userId: string,
  seeds: LedgerPositionSeed[],
  now: Date,
) {
  if (seeds.length === 0) return;
  const positions = await store.findOwnedPositions(
    transaction,
    userId,
    seeds.map(({ id }) => id),
  );
  const byId = new Map(positions.map((position) => [position.id, position]));

  for (const seed of seeds) {
    const existing = byId.get(seed.id);
    if (existing) {
      assertPositionSeedMatches(existing, seed);
      continue;
    }
    const created = await store.createPosition(transaction, {
      userId,
      seed,
      archivedAt: now,
    });
    assertPositionSeedMatches(created, seed);
    byId.set(created.id, created);
  }
}

async function validateTimelineAndLifecycle<Transaction>(
  store: PortfolioTransactionStore<Transaction>,
  transaction: Transaction,
  userId: string,
  positionIds: string[],
  now: Date,
) {
  const uniqueIds = Array.from(new Set(positionIds));
  const rows = await store.getTimeline(transaction, userId, uniqueIds);
  const balances = assertNonnegativeTimeline(rows);

  for (const positionId of uniqueIds) {
    const balance = balances.get(positionId) ?? "0";
    await store.setArchivedAt(
      transaction,
      userId,
      positionId,
      decimalToUnits(balance) === BigInt(0) ? now : null,
    );
  }
}

export async function recordTransaction<Transaction>(
  store: PortfolioTransactionStore<Transaction>,
  userId: string,
  intent: RecordTransactionIntent,
  now = new Date(),
): Promise<StoredLedgerEvent> {
  return store.runSerializable(async (transaction) => {
    const user = await requireAdoptedUser(store, transaction, userId);
    const idempotencyKey = normalizeIdempotencyKey(intent.idempotencyKey);
    const prepared = prepareIntent(intent, userId, idempotencyKey);
    const normalized = buildEventDraft(
      { ...prepared.intent, idempotencyKey },
      user.ledgerAdoptedAt,
      now,
    );
    await requireOwnedPositions(
      store,
      transaction,
      userId,
      prepared.requiredExistingPositionIds,
    );

    const existing = await store.findOwnedEventByKey(
      transaction,
      userId,
      normalized.idempotencyKey,
    );
    if (existing) {
      assertIdempotentMatch(existing, normalized.event);
      await validateExistingPositionSeeds(
        store,
        transaction,
        userId,
        prepared.newPositions,
      );
      return existing;
    }

    await requirePositiveOwnedPositions(
      store,
      transaction,
      userId,
      prepared.requiredExistingPositionIds,
    );

    await ensurePositionSeeds(
      store,
      transaction,
      userId,
      prepared.newPositions,
      now,
    );
    await requireOwnedPositions(
      store,
      transaction,
      userId,
      uniquePositionIds(normalized.event),
    );

    const created = await store.createEvent(transaction, {
      userId,
      idempotencyKey: normalized.idempotencyKey,
      event: normalized.event,
    });
    await validateTimelineAndLifecycle(
      store,
      transaction,
      userId,
      uniquePositionIds(normalized.event),
      now,
    );
    await store.flushLedgerConstraints(transaction);
    return created;
  });
}

export async function reverseTransaction<Transaction>(
  store: PortfolioTransactionStore<Transaction>,
  userId: string,
  eventId: string,
  baseIdempotencyKey: string,
  now = new Date(),
): Promise<StoredLedgerEvent> {
  return store.runSerializable(async (transaction) => {
    await requireAdoptedUser(store, transaction, userId);
    const original = await store.findOwnedEvent(transaction, userId, eventId);
    if (!original) {
      throw new LedgerValidationError("Transaction not found.", "NOT_FOUND");
    }

    const draft = buildReversalDraft(original);
    const idempotencyKey = reversalKey(baseIdempotencyKey);
    const existing = await store.findOwnedEventByKey(
      transaction,
      userId,
      idempotencyKey,
    );
    if (existing) {
      assertIdempotentMatch(existing, draft);
      return existing;
    }

    if (await store.findReversalFor(transaction, userId, original.id)) {
      throw new LedgerValidationError(
        "That transaction has already been reversed.",
        "ALREADY_REVERSED",
      );
    }

    await requireOwnedPositions(
      store,
      transaction,
      userId,
      uniquePositionIds(draft),
    );
    const created = await store.createEvent(transaction, {
      userId,
      idempotencyKey,
      event: draft,
    });
    await validateTimelineAndLifecycle(
      store,
      transaction,
      userId,
      uniquePositionIds(draft),
      now,
    );
    await store.flushLedgerConstraints(transaction);
    return created;
  });
}

export async function correctTransaction<Transaction>(
  store: PortfolioTransactionStore<Transaction>,
  userId: string,
  input: CorrectionInput,
  now = new Date(),
): Promise<{ reversal: StoredLedgerEvent; replacement: StoredLedgerEvent }> {
  return store.runSerializable(async (transaction) => {
    const user = await requireAdoptedUser(store, transaction, userId);
    const original = await store.findOwnedEvent(
      transaction,
      userId,
      input.eventId,
    );
    if (!original) {
      throw new LedgerValidationError("Transaction not found.", "NOT_FOUND");
    }
    if (!isEconomicEventKind(original.kind)) {
      throw new LedgerValidationError(
        "Opening balances and reversals cannot be corrected.",
        "NOT_REVERSIBLE",
      );
    }

    const reversalDraft = buildReversalDraft(original);
    const keys = correctionKeys(input.idempotencyKey);
    const preparedReplacement = prepareIntent(
      { ...input.replacement, idempotencyKey: input.idempotencyKey },
      userId,
      keys.replacement,
    );
    const normalizedReplacement = buildEventDraft(
      preparedReplacement.intent,
      user.ledgerAdoptedAt,
      now,
    );
    if (normalizedReplacement.event.kind !== original.kind) {
      throw new LedgerValidationError(
        "A correction must keep the original transaction type.",
        "INVALID_INPUT",
      );
    }
    const replacementDraft: LedgerEventDraft = {
      ...normalizedReplacement.event,
      kind: original.kind,
      replacementForEventId: original.id,
    };

    const [existingReversal, existingReplacement] = await Promise.all([
      store.findOwnedEventByKey(transaction, userId, keys.reversal),
      store.findOwnedEventByKey(transaction, userId, keys.replacement),
    ]);
    if (existingReversal || existingReplacement) {
      if (!existingReversal || !existingReplacement) {
        throw new LedgerValidationError(
          "The correction idempotency pair is incomplete.",
          "DUPLICATE_KEY",
        );
      }
      assertIdempotentMatch(existingReversal, reversalDraft);
      assertIdempotentMatch(existingReplacement, replacementDraft);
      await validateExistingPositionSeeds(
        store,
        transaction,
        userId,
        preparedReplacement.newPositions,
      );
      return {
        reversal: existingReversal,
        replacement: existingReplacement,
      };
    }

    if (await store.findReversalFor(transaction, userId, original.id)) {
      throw new LedgerValidationError(
        "That transaction has already been reversed.",
        "ALREADY_REVERSED",
      );
    }

    await requireOwnedPositions(
      store,
      transaction,
      userId,
      preparedReplacement.requiredExistingPositionIds,
    );
    await ensurePositionSeeds(
      store,
      transaction,
      userId,
      preparedReplacement.newPositions,
      now,
    );

    const positionIds = Array.from(
      new Set([
        ...uniquePositionIds(reversalDraft),
        ...uniquePositionIds(replacementDraft),
      ]),
    );
    await requireOwnedPositions(store, transaction, userId, positionIds);

    const reversal = await store.createEvent(transaction, {
      userId,
      idempotencyKey: keys.reversal,
      event: reversalDraft,
    });
    const replacement = await store.createEvent(transaction, {
      userId,
      idempotencyKey: keys.replacement,
      event: replacementDraft,
    });

    // Both writes exist before timeline validation. This removes the original
    // and applies its replacement as one correction, without testing an
    // artificial intermediate state.
    await validateTimelineAndLifecycle(
      store,
      transaction,
      userId,
      positionIds,
      now,
    );
    await store.flushLedgerConstraints(transaction);
    return { reversal, replacement };
  });
}
