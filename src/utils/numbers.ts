export function formatNumber(
  value: number | string | null | undefined,
  maximumFractionDigits = 8,
): string {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return "—";
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(numericValue);
}

export function formatCurrency(
  value: number | string | null | undefined,
): string {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return "—";
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(numericValue);
}

export function formatPercentage(
  value: number | string | null | undefined,
): string {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return "—";
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "—";
  }

  return `${formatNumber(numericValue, 2)}%`;
}
