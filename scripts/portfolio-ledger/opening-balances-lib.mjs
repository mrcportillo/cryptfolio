import { createHash } from "node:crypto";

const DECIMAL_PATTERN =
  /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

export const OPENING_BALANCE_VERSION = "v1";
export const QUANTITY_PRECISION = 65;
export const QUANTITY_SCALE = 30;
export const QUANTITY_INTEGER_DIGITS = QUANTITY_PRECISION - QUANTITY_SCALE;

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function requiredOptionValue(argv, index, option) {
  const value = argv[index + 1];
  invariant(value && !value.startsWith("--"), `${option} requires a value.`);
  return value;
}

export function normalizeAdoptionTimestamp(value) {
  invariant(
    ISO_TIMESTAMP_PATTERN.test(value),
    "--adoption-at must be an exact UTC ISO timestamp with milliseconds (for example 2026-08-20T15:30:00.000Z).",
  );

  const parsed = new Date(value);
  invariant(
    !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value,
    "--adoption-at is not a valid UTC timestamp.",
  );

  return value;
}

export function parseOpeningBalanceArguments(argv) {
  const result = {
    apply: false,
    help: false,
    userId: null,
    adoptionAt: null,
    expectedFingerprint: null,
  };
  const seen = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--") {
      invariant(
        index === 0,
        "The option separator must be the first argument.",
      );
      continue;
    }

    invariant(
      option.startsWith("--"),
      `Unexpected positional argument: ${option}`,
    );
    invariant(!seen.has(option), `Option supplied more than once: ${option}`);
    seen.add(option);

    if (option === "--apply") {
      result.apply = true;
      continue;
    }

    if (option === "--help") {
      result.help = true;
      continue;
    }

    if (option === "--user-id") {
      result.userId = requiredOptionValue(argv, index, option);
      index += 1;
      continue;
    }

    if (option === "--adoption-at") {
      result.adoptionAt = normalizeAdoptionTimestamp(
        requiredOptionValue(argv, index, option),
      );
      index += 1;
      continue;
    }

    if (option === "--expected-fingerprint") {
      result.expectedFingerprint = requiredOptionValue(
        argv,
        index,
        option,
      ).toLowerCase();
      invariant(
        FINGERPRINT_PATTERN.test(result.expectedFingerprint),
        "--expected-fingerprint must be a 64-character SHA-256 hex digest.",
      );
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${option}`);
  }

  if (result.help) {
    return result;
  }

  invariant(result.userId?.trim(), "--user-id is required.");
  invariant(
    result.userId === result.userId.trim(),
    "--user-id cannot have leading or trailing whitespace.",
  );

  if (result.apply) {
    invariant(
      result.adoptionAt,
      "--apply requires a fixed --adoption-at timestamp.",
    );
    invariant(
      result.expectedFingerprint,
      "--apply requires --expected-fingerprint from a dry run.",
    );
  } else {
    invariant(
      !result.expectedFingerprint,
      "--expected-fingerprint is only accepted together with --apply.",
    );
  }

  return result;
}

export function openingBalanceHelp() {
  return `Usage:
  pnpm ledger:opening-balances -- --user-id <auth0-sub> [--adoption-at <ISO>]
  pnpm ledger:opening-balances -- --user-id <auth0-sub> --apply \\
    --adoption-at <ISO> --expected-fingerprint <sha256>

The command is read-only unless --apply is present. Always run the dry run first,
record its legacyFingerprint, and use the same fixed adoption timestamp for apply.`;
}

export function canonicalDecimal(value) {
  invariant(typeof value === "string", "Legacy quantity must arrive as text.");
  invariant(value === value.trim(), "Legacy quantity contains whitespace.");

  const match = DECIMAL_PATTERN.exec(value);
  invariant(match, `Legacy quantity is not finite decimal text: ${value}`);

  const sign = match[1];
  const integerPart = match[2] ?? "0";
  const fractionalPart = match[3] ?? match[4] ?? "";
  const exponent = Number.parseInt(match[5] ?? "0", 10);
  invariant(
    Number.isSafeInteger(exponent) && Math.abs(exponent) <= 1_000,
    `Legacy quantity exponent is not representable: ${value}`,
  );

  const digits = `${integerPart}${fractionalPart}`;
  const decimalIndex = integerPart.length + exponent;
  let integerDigits;
  let fractionalDigits;

  if (decimalIndex <= 0) {
    integerDigits = "0";
    fractionalDigits = `${"0".repeat(-decimalIndex)}${digits}`;
  } else if (decimalIndex >= digits.length) {
    integerDigits = `${digits}${"0".repeat(decimalIndex - digits.length)}`;
    fractionalDigits = "";
  } else {
    integerDigits = digits.slice(0, decimalIndex);
    fractionalDigits = digits.slice(decimalIndex);
  }

  integerDigits = integerDigits.replace(/^0+(?=\d)/, "");
  fractionalDigits = fractionalDigits.replace(/0+$/, "");

  if (/^0+$/.test(integerDigits) && fractionalDigits.length === 0) {
    return "0";
  }

  const significantIntegerDigits = integerDigits.replace(/^0+/, "").length;
  invariant(
    significantIntegerDigits <= QUANTITY_INTEGER_DIGITS,
    `Legacy quantity exceeds ${QUANTITY_INTEGER_DIGITS} integer digits: ${value}`,
  );
  invariant(
    fractionalDigits.length <= QUANTITY_SCALE,
    `Legacy quantity exceeds ${QUANTITY_SCALE} fractional digits: ${value}`,
  );

  const unsigned = fractionalDigits
    ? `${integerDigits}.${fractionalDigits}`
    : integerDigits;

  return sign === "-" ? `-${unsigned}` : unsigned;
}

function fingerprintField(value) {
  invariant(typeof value === "string", "Fingerprint fields must be strings.");
  return `${Buffer.byteLength(value, "utf8")}:${value}`;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function openingIdempotencyKey(userAssetId) {
  const key = `opening:${OPENING_BALANCE_VERSION}:${userAssetId}`;
  invariant(
    Buffer.byteLength(key, "utf8") <= 160,
    `Position ${userAssetId} cannot fit the opening idempotency key.`,
  );
  return key;
}

export function prepareLegacyPositions(userId, rows) {
  invariant(Array.isArray(rows), "Legacy positions must be an array.");
  const seenIds = new Set();

  const positions = rows.map((row) => {
    for (const field of [
      "id",
      "userId",
      "assetId",
      "assetName",
      "amountText",
      "dateText",
    ]) {
      invariant(
        typeof row[field] === "string",
        `Legacy ${field} must be text.`,
      );
    }

    invariant(
      row.userId === userId,
      `Position ${row.id} belongs to another user.`,
    );
    invariant(!seenIds.has(row.id), `Duplicate legacy position id: ${row.id}`);
    seenIds.add(row.id);

    const quantity = canonicalDecimal(row.amountText);
    invariant(
      !quantity.startsWith("-"),
      `Position ${row.id} has a negative quantity.`,
    );
    invariant(
      ISO_TIMESTAMP_PATTERN.test(row.dateText),
      `Position ${row.id} has a non-canonical date.`,
    );

    return {
      ...row,
      quantity,
      idempotencyKey: openingIdempotencyKey(row.id),
      positive: quantity !== "0",
    };
  });

  return positions.sort((left, right) => compareUtf8(left.id, right.id));
}

export function legacyFingerprint(userId, positions) {
  const records = positions.map((position) =>
    [
      position.id,
      position.userId,
      position.assetId,
      position.assetName,
      position.amountText,
      position.dateText,
    ]
      .map(fingerprintField)
      .join("|"),
  );
  const payload = [
    "portfolio-opening-v1",
    fingerprintField(userId),
    records.join("\n"),
  ].join("\n");

  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function openingFingerprint(records) {
  const payload = records
    .map((record) =>
      [
        record.eventId ?? "",
        record.eventUserId ?? "",
        record.kind ?? "",
        record.occurredAtText ?? "",
        record.externalFlowUsdText ?? "",
        record.feeUsdText ?? "",
        record.idempotencyKey ?? "",
        record.openingForUserAssetId ?? "",
        record.movementId ?? "",
        record.movementUserId ?? "",
        record.movementUserAssetId ?? "",
        record.quantityDeltaText ?? "",
        record.unitPriceUsdText ?? "",
        String(record.priceEstimated ?? ""),
      ]
        .map(fingerprintField)
        .join("|"),
    )
    .sort(compareUtf8)
    .join("\n");

  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function verifyOpeningRecords({
  userId,
  adoptionAt,
  positivePositions,
  records,
}) {
  const expectedByAsset = new Map(
    positivePositions.map((position) => [position.id, position]),
  );
  const recordsByEvent = new Map();

  for (const record of records) {
    invariant(
      record.eventUserId === userId && record.movementUserId === userId,
      "Opening records crossed an ownership boundary.",
    );

    const eventRows = recordsByEvent.get(record.eventId) ?? [];
    eventRows.push(record);
    recordsByEvent.set(record.eventId, eventRows);
  }

  invariant(
    recordsByEvent.size === positivePositions.length,
    `Expected ${positivePositions.length} opening events, found ${recordsByEvent.size}.`,
  );

  const seenAssets = new Set();

  for (const eventRows of recordsByEvent.values()) {
    const event = eventRows[0];
    const position = expectedByAsset.get(event.openingForUserAssetId);

    invariant(position, `Unexpected opening event ${event.eventId}.`);
    invariant(
      !seenAssets.has(position.id),
      `Position ${position.id} has duplicate opening events.`,
    );
    seenAssets.add(position.id);
    invariant(
      eventRows.length === 1,
      `Opening event ${event.eventId} must have one movement.`,
    );
    invariant(
      event.kind === "OPENING_BALANCE",
      `Event ${event.eventId} has the wrong kind.`,
    );
    invariant(
      event.occurredAtText === adoptionAt,
      `Event ${event.eventId} has the wrong adoption timestamp.`,
    );
    invariant(
      canonicalDecimal(event.externalFlowUsdText) === "0" &&
        canonicalDecimal(event.feeUsdText) === "0",
      `Opening event ${event.eventId} has reportable flow or fees.`,
    );
    invariant(
      event.idempotencyKey === position.idempotencyKey,
      `Opening event ${event.eventId} has the wrong idempotency key.`,
    );
    invariant(
      event.movementId,
      `Opening event ${event.eventId} has no movement.`,
    );
    invariant(
      event.movementUserAssetId === position.id,
      `Opening movement ${event.movementId} targets the wrong position.`,
    );
    invariant(
      canonicalDecimal(event.quantityDeltaText) === position.quantity,
      `Opening movement ${event.movementId} changed the legacy quantity.`,
    );
    invariant(
      event.unitPriceUsdText === null && event.priceEstimated === false,
      `Opening movement ${event.movementId} must not invent a price.`,
    );
  }

  invariant(
    seenAssets.size === expectedByAsset.size,
    "At least one positive position is missing an opening event.",
  );

  return {
    openingCount: recordsByEvent.size,
    openingFingerprint: openingFingerprint(records),
  };
}

export function verifyDerivedQuantities({ userId, positions, quantities }) {
  invariant(
    quantities.length === positions.length,
    `Expected ${positions.length} derived positions, found ${quantities.length}.`,
  );
  const expectedByAsset = new Map(
    positions.map((position) => [position.id, position]),
  );
  const seenAssets = new Set();

  for (const quantity of quantities) {
    invariant(
      quantity.userId === userId,
      "Derived quantities crossed an ownership boundary.",
    );
    const position = expectedByAsset.get(quantity.userAssetId);
    invariant(position, `Unexpected derived position ${quantity.userAssetId}.`);
    invariant(
      !seenAssets.has(position.id),
      `Duplicate derived position ${position.id}.`,
    );
    seenAssets.add(position.id);
    invariant(
      canonicalDecimal(quantity.quantityText) === position.quantity,
      `Derived quantity for ${position.id} does not match the legacy amount.`,
    );
  }
}

function sameTimestamp(left, right) {
  return left === right;
}

export async function runOpeningBalanceConversion({
  store,
  userId,
  adoptionAt = null,
  expectedFingerprint = null,
  apply = false,
}) {
  invariant(store, "An opening-balance store is required.");
  invariant(userId, "A user id is required.");

  if (apply) {
    invariant(adoptionAt, "Apply mode requires an adoption timestamp.");
    invariant(expectedFingerprint, "Apply mode requires a legacy fingerprint.");
  }

  return store.runSerializable(async (transaction) => {
    const user = apply
      ? await store.lockUser(transaction, userId)
      : await store.getUser(transaction, userId);
    invariant(user, `User not found: ${userId}`);

    const rows = await store.getLegacyPositions(transaction, userId, {
      lock: apply,
    });
    const positions = prepareLegacyPositions(userId, rows);
    const positivePositions = positions.filter((position) => position.positive);
    const fingerprint = legacyFingerprint(userId, positions);
    const verifyLedgerState = async () => {
      const [records, quantities] = await Promise.all([
        store.getOpeningRecords(transaction, userId),
        store.getDerivedQuantities(transaction, userId),
      ]);
      const verification = verifyOpeningRecords({
        userId,
        adoptionAt: user.ledgerAdoptedAt ?? adoptionAt,
        positivePositions,
        records,
      });
      verifyDerivedQuantities({ userId, positions, quantities });
      return verification;
    };

    if (!apply) {
      let verification = null;
      if (user.ledgerAdoptedAt) {
        verification = await verifyLedgerState();
      }

      return {
        mode: "dry-run",
        userId,
        adoptionAt: adoptionAt ?? user.ledgerAdoptedAt,
        alreadyAdopted: Boolean(user.ledgerAdoptedAt),
        legacyPositionCount: positions.length,
        openingCount: positivePositions.length,
        skippedZeroCount: positions.length - positivePositions.length,
        legacyFingerprint: fingerprint,
        openingFingerprint: verification?.openingFingerprint ?? null,
      };
    }

    invariant(
      fingerprint === expectedFingerprint,
      `Legacy fingerprint changed. Expected ${expectedFingerprint}, found ${fingerprint}. Run a new dry run.`,
    );

    if (user.ledgerAdoptedAt) {
      invariant(
        sameTimestamp(user.ledgerAdoptedAt, adoptionAt),
        `User was already adopted at ${user.ledgerAdoptedAt}, not ${adoptionAt}.`,
      );
      const verification = await verifyLedgerState();

      return {
        mode: "apply",
        userId,
        adoptionAt,
        alreadyApplied: true,
        legacyPositionCount: positions.length,
        skippedZeroCount: positions.length - positivePositions.length,
        legacyFingerprint: fingerprint,
        ...verification,
      };
    }

    for (const position of positivePositions) {
      await store.createOpening(transaction, {
        userId,
        adoptionAt,
        position,
      });
    }

    await store.flushOpeningConstraints(transaction);
    await verifyLedgerState();

    const adoptedUser = await store.markLedgerAdopted(
      transaction,
      userId,
      adoptionAt,
    );
    invariant(adoptedUser, "Could not persist the ledger adoption boundary.");
    invariant(
      sameTimestamp(adoptedUser.ledgerAdoptedAt, adoptionAt),
      "The persisted ledger adoption boundary does not match the requested timestamp.",
    );

    const verification = await verifyLedgerState();

    return {
      mode: "apply",
      userId,
      adoptionAt,
      alreadyApplied: false,
      legacyPositionCount: positions.length,
      skippedZeroCount: positions.length - positivePositions.length,
      legacyFingerprint: fingerprint,
      ...verification,
    };
  });
}
