import type {
  EconomicEventKind,
  LedgerEventKind,
  LedgerMovementDraft,
} from "@/services/portfolio-transactions/domain";

export const PORTFOLIO_TIME_ZONE = "America/Argentina/Salta";
export const PORTFOLIO_UTC_OFFSET = "-03:00";

export const TRANSACTION_KIND_OPTIONS: ReadonlyArray<{
  value: EconomicEventKind;
  label: string;
  description: string;
}> = [
  {
    value: "BUY",
    label: "Buy",
    description: "Add crypto paid for outside this portfolio.",
  },
  {
    value: "SELL",
    label: "Sell",
    description: "Remove crypto and record proceeds received outside.",
  },
  {
    value: "TRANSFER_IN",
    label: "Transfer in",
    description: "Move crypto into the tracked portfolio.",
  },
  {
    value: "TRANSFER_OUT",
    label: "Transfer out",
    description: "Move crypto out of the tracked portfolio.",
  },
  {
    value: "SWAP",
    label: "Swap",
    description: "Exchange one tracked crypto position for another.",
  },
  {
    value: "FEE",
    label: "Fee",
    description: "Record a standalone fee paid in tracked crypto.",
  },
];

const KIND_LABELS: Record<LedgerEventKind, string> = {
  OPENING_BALANCE: "Opening balance",
  BUY: "Buy",
  SELL: "Sell",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
  SWAP: "Swap",
  FEE: "Fee",
  REVERSAL: "Reversal",
};

export function transactionKindLabel(kind: LedgerEventKind): string {
  return KIND_LABELS[kind];
}

export function formatExactDecimal(value: string): string {
  const sign = value.startsWith("-") ? "-" : "";
  const unsigned = sign ? value.slice(1) : value;
  const [integer = "0", fraction] = unsigned.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
}

export function absoluteDecimal(value: string): string {
  return value.startsWith("-") ? value.slice(1) : value;
}

export function formatExactUsd(value: string | null): string {
  if (value === null) return "Unknown · unvalued";
  const negative = value.startsWith("-");
  const amount = formatExactDecimal(absoluteDecimal(value));
  return `${negative ? "−" : ""}$${amount}`;
}

export function formatSignedQuantity(value: string): string {
  if (value.startsWith("-")) return `−${formatExactDecimal(value.slice(1))}`;
  if (/^0(?:\.0+)?$/.test(value)) return formatExactDecimal(value);
  return `+${formatExactDecimal(value)}`;
}

export function formatPortfolioDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PORTFOLIO_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

export function formatPortfolioInputDate(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PORTFOLIO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, "0");
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}.${milliseconds}`;
}

export function toExplicitPortfolioTimestamp(localValue: string): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(
      localValue,
    );
  if (!match) {
    throw new Error("Choose a valid local date and time.");
  }
  const [, year, month, day, hour, minute, seconds = "00", fraction] = match;
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  const secondNumber = Number(seconds);
  const leapYear =
    yearNumber % 4 === 0 && (yearNumber % 100 !== 0 || yearNumber % 400 === 0);
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
  ][monthNumber - 1];
  if (
    daysInMonth === undefined ||
    dayNumber < 1 ||
    dayNumber > daysInMonth ||
    hourNumber > 23 ||
    minuteNumber > 59 ||
    secondNumber > 59
  ) {
    throw new Error("Choose a valid local date and time.");
  }
  const explicit = `${year}-${month}-${day}T${hour}:${minute}:${seconds}${fraction ? `.${fraction}` : ""}${PORTFOLIO_UTC_OFFSET}`;
  if (Number.isNaN(new Date(explicit).getTime())) {
    throw new Error("Choose a valid local date and time.");
  }
  return explicit;
}

export function movementPriceProvenance(
  movement: Pick<LedgerMovementDraft, "unitPriceUsd" | "priceEstimated">,
): string {
  if (movement.unitPriceUsd === null) return "No unit price recorded";
  return movement.priceEstimated
    ? "Estimated unit price"
    : "Recorded unit price";
}
