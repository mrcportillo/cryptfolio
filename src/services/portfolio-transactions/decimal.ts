export const LEDGER_DECIMAL_SCALE = 30;
export const LEDGER_DECIMAL_INTEGER_DIGITS = 35;

const ZERO = BigInt(0);
const SCALE_FACTOR = BigInt(10) ** BigInt(LEDGER_DECIMAL_SCALE);
const DECIMAL_PATTERN = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/;
const FINITE_NUMBER_PATTERN = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i;

export class LedgerDecimalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerDecimalError";
  }
}

export function decimalToUnits(value: string): bigint {
  const normalized = value.trim();
  const match = DECIMAL_PATTERN.exec(normalized);

  if (!match) {
    throw new LedgerDecimalError("Enter a plain decimal number.");
  }

  const [, sign, integer, fraction = ""] = match;
  if (integer.length > LEDGER_DECIMAL_INTEGER_DIGITS) {
    throw new LedgerDecimalError("The number is too large for the ledger.");
  }
  if (fraction.length > LEDGER_DECIMAL_SCALE) {
    throw new LedgerDecimalError(
      `Use no more than ${LEDGER_DECIMAL_SCALE} decimal places.`,
    );
  }

  const magnitude =
    BigInt(integer) * SCALE_FACTOR +
    BigInt(fraction.padEnd(LEDGER_DECIMAL_SCALE, "0") || "0");
  return sign === "-" ? -magnitude : magnitude;
}

export function unitsToDecimal(value: bigint): string {
  if (value === ZERO) return "0";

  const sign = value < ZERO ? "-" : "";
  const magnitude = value < ZERO ? -value : value;
  const integer = magnitude / SCALE_FACTOR;
  const fraction = (magnitude % SCALE_FACTOR)
    .toString()
    .padStart(LEDGER_DECIMAL_SCALE, "0")
    .replace(/0+$/, "");

  return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
}

export function canonicalDecimal(value: string): string {
  return unitsToDecimal(decimalToUnits(value));
}

/**
 * Converts the already-approximate JavaScript number at a provider boundary
 * into the canonical plain decimal representation used by the ledger.
 */
export function normalizeFiniteNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new LedgerDecimalError("The provider value must be finite.");
  }
  if (Object.is(value, -0)) return "0";

  const text = value.toString();
  const match = FINITE_NUMBER_PATTERN.exec(text);
  if (!match) {
    throw new LedgerDecimalError("The provider value is not a decimal number.");
  }

  const [, sign, integer, fraction = "", exponentText] = match;
  if (exponentText === undefined) return canonicalDecimal(text);

  const exponent = Number.parseInt(exponentText, 10);
  if (!Number.isSafeInteger(exponent)) {
    throw new LedgerDecimalError("The provider exponent is not representable.");
  }

  const digits = `${integer}${fraction}`;
  const decimalIndex = integer.length + exponent;
  let plain: string;
  if (decimalIndex <= 0) {
    plain = `0.${"0".repeat(-decimalIndex)}${digits}`;
  } else if (decimalIndex >= digits.length) {
    plain = `${digits}${"0".repeat(decimalIndex - digits.length)}`;
  } else {
    plain = `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  }

  return canonicalDecimal(`${sign}${plain}`);
}

export function databaseDecimalToPlain(value: { toFixed(): string }): string {
  const plain = value.toFixed();
  return /^-0(?:\.0+)?$/.test(plain) ? "0" : plain;
}

export function positiveDecimal(value: string, field: string): string {
  const units = decimalToUnits(value);
  if (units <= ZERO) {
    throw new LedgerDecimalError(`${field} must be greater than zero.`);
  }
  return unitsToDecimal(units);
}

export function negateDecimal(value: string): string {
  return unitsToDecimal(-decimalToUnits(value));
}

export function addDecimals(left: string, right: string): string {
  return unitsToDecimal(decimalToUnits(left) + decimalToUnits(right));
}

export function subtractDecimals(left: string, right: string): string {
  return unitsToDecimal(decimalToUnits(left) - decimalToUnits(right));
}

export function compareDecimals(left: string, right: string): -1 | 0 | 1 {
  const difference = decimalToUnits(left) - decimalToUnits(right);
  if (difference < ZERO) return -1;
  if (difference > ZERO) return 1;
  return 0;
}

/**
 * Multiplies two scale-30 values exactly and rounds once, half away from zero,
 * back to scale 30 for persistence.
 */
export function multiplyDecimals(left: string, right: string): string {
  const product = decimalToUnits(left) * decimalToUnits(right);
  const sign = product < ZERO ? BigInt(-1) : BigInt(1);
  const magnitude = product < ZERO ? -product : product;
  let rounded = magnitude / SCALE_FACTOR;
  const remainder = magnitude % SCALE_FACTOR;
  if (remainder * BigInt(2) >= SCALE_FACTOR) rounded += BigInt(1);

  const result = unitsToDecimal(sign * rounded);
  // A multiplied value is persisted at this boundary.
  decimalToUnits(result);
  return result;
}

export function absoluteDifference(left: string, right: string): string {
  const difference = decimalToUnits(left) - decimalToUnits(right);
  return unitsToDecimal(difference < ZERO ? -difference : difference);
}

export function sumDecimals(values: Iterable<string>): string {
  let total = ZERO;
  for (const value of values) total += decimalToUnits(value);
  const result = unitsToDecimal(total);
  // Aggregates are persisted after their already-quantized inputs are summed.
  decimalToUnits(result);
  return result;
}

export function isWithinDecimalTolerance(
  left: string,
  right: string,
  tolerance: string,
): boolean {
  const toleranceUnits = decimalToUnits(tolerance);
  if (toleranceUnits < ZERO) {
    throw new LedgerDecimalError("Tolerance cannot be negative.");
  }
  const difference = decimalToUnits(left) - decimalToUnits(right);
  const magnitude = difference < ZERO ? -difference : difference;
  return magnitude <= toleranceUnits;
}
