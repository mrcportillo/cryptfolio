export const LEDGER_DECIMAL_SCALE = 30;
export const LEDGER_DECIMAL_INTEGER_DIGITS = 35;

const ZERO = BigInt(0);
const SCALE_FACTOR = BigInt(10) ** BigInt(LEDGER_DECIMAL_SCALE);
const DECIMAL_PATTERN = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/;

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
