export function unitsToNumber(rawValue: string, decimals: number): number {
  const negative = rawValue.startsWith("-");
  const digits = negative ? rawValue.slice(1) : rawValue;
  const padded = digits.padStart(decimals + 1, "0");
  const integer = decimals === 0 ? padded : padded.slice(0, -decimals);
  const fraction = decimals === 0 ? "" : padded.slice(-decimals);
  const value = Number(fraction ? `${integer}.${fraction}` : integer);
  return negative ? -value : value;
}

export function asFiniteNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatAmount(value: number): string {
  if (value >= 1_000_000) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  }

  if (value >= 1_000) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  }

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 5 }).format(value);
}
