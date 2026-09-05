export function formatValuationUsd(
  value: string | null,
  signed = false,
): string {
  if (value === null) return "Unavailable";
  const [integer, fraction = ""] = value.split(".");
  const negative = integer.startsWith("-");
  const padded = `${fraction}000`;
  let cents =
    BigInt(negative ? integer.slice(1) : integer) * BigInt(100) +
    BigInt(padded.slice(0, 2));
  if (padded[2] >= "5") cents += BigInt(1);
  const whole = (cents / BigInt(100))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative && cents !== BigInt(0) ? "−" : signed && cents !== BigInt(0) ? "+" : ""}$${whole}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
}

export function reportTimestamp(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Salta",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
