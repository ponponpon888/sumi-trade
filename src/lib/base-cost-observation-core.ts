import { estimateExecutionCost } from "@/lib/execution-cost";

export const BASE_COST_REQUESTED_YEN = 500 as const;
export const BASE_COST_BUCKET_MS = 60 * 60 * 1_000;
export const BASE_COST_RECORD_WINDOW_DAYS = 31 as const;

// Stable codes getBasePaperQuote can throw. Anything else is stored as UNKNOWN so
// raw error text never reaches storage.
const QUOTE_ERROR_CODES = [
  "INVALID_AMOUNT",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "INVALID_PROVIDER_DATA",
  "PRICE_RESPONSE_INVALID",
  "BUY_ROUTE_RESPONSE_INVALID",
  "SELL_ROUTE_RESPONSE_INVALID",
  "PRICE_STALE",
  "QUOTE_MISMATCH",
  "QUOTE_STALE",
  "AMOUNT_TOO_LOW",
  "OBSERVATION_EXPIRED",
] as const;

export type BaseCostErrorCode = (typeof QUOTE_ERROR_CODES)[number] | "UNKNOWN";

/** The fields of a getBasePaperQuote result this observation keeps. */
export interface BaseCostQuoteInput {
  requestedYen: number;
  valuation: { ethJpy: number; ethUsd: number };
  providerSwapGasEstimateYen: { buy: number; sell: number };
  swapShortfallEstimateYen: number;
  knownCostEstimateYen: number;
  providerL1FeeEstimateYen: { total: number | null };
  providerKnownCostEstimateYen: number | null;
}

export type BaseCostRecord = {
  schemaVersion: 1;
  id: string;
  bucketTimeMs: number;
  observedAt: string;
  requestedYen: typeof BASE_COST_REQUESTED_YEN;
  executionLocked: true;
} & (
  | {
      status: "observed";
      ethJpy: number;
      ethUsd: number;
      /** Round-trip minimum-proceeds shortfall at the 0.5%/leg research slippage. */
      swapShortfallEstimateYen: number;
      swapGasEstimateYen: number;
      /** Shortfall + swap gas; excludes L1 fees (see providerKnownCostEstimateYen). */
      knownCostEstimateYen: number;
      providerL1FeeEstimateYen: number | null;
      providerKnownCostEstimateYen: number | null;
    }
  | { status: "unavailable"; errorCode: BaseCostErrorCode }
);

function bucketStart(nowMs: number): number {
  return Math.floor(nowMs / BASE_COST_BUCKET_MS) * BASE_COST_BUCKET_MS;
}

export function baseCostBucketId(nowMs: number): string {
  return new Date(bucketStart(nowMs)).toISOString().replace(/[:.]/g, "-");
}

function base(nowMs: number) {
  return {
    schemaVersion: 1 as const,
    id: baseCostBucketId(nowMs),
    bucketTimeMs: bucketStart(nowMs),
    observedAt: new Date(nowMs).toISOString(),
    requestedYen: BASE_COST_REQUESTED_YEN,
    executionLocked: true as const,
  };
}

export function createObservedBaseCostRecord(
  quote: BaseCostQuoteInput,
  nowMs: number,
): BaseCostRecord {
  if (quote.requestedYen !== BASE_COST_REQUESTED_YEN) {
    throw new Error("Base cost observation expects a 500 yen quote.");
  }
  return {
    ...base(nowMs),
    status: "observed",
    ethJpy: quote.valuation.ethJpy,
    ethUsd: quote.valuation.ethUsd,
    swapShortfallEstimateYen: quote.swapShortfallEstimateYen,
    swapGasEstimateYen:
      quote.providerSwapGasEstimateYen.buy + quote.providerSwapGasEstimateYen.sell,
    knownCostEstimateYen: quote.knownCostEstimateYen,
    providerL1FeeEstimateYen: quote.providerL1FeeEstimateYen.total,
    providerKnownCostEstimateYen: quote.providerKnownCostEstimateYen,
  };
}

export function createUnavailableBaseCostRecord(
  errorCode: string,
  nowMs: number,
): BaseCostRecord {
  return {
    ...base(nowMs),
    status: "unavailable",
    errorCode: (QUOTE_ERROR_CODES as readonly string[]).includes(errorCode)
      ? (errorCode as BaseCostErrorCode)
      : "UNKNOWN",
  };
}

export function isBaseCostRecord(value: unknown): value is BaseCostRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<Record<string, unknown>>;
  const finite = (key: string) =>
    typeof record[key] === "number" && Number.isFinite(record[key]);
  const nullableFinite = (key: string) => record[key] === null || finite(key);
  if (
    record.schemaVersion !== 1 ||
    record.executionLocked !== true ||
    record.requestedYen !== BASE_COST_REQUESTED_YEN ||
    typeof record.id !== "string" ||
    typeof record.observedAt !== "string" ||
    !finite("bucketTimeMs")
  ) {
    return false;
  }
  if (record.status === "unavailable") return typeof record.errorCode === "string";
  return (
    record.status === "observed" &&
    finite("ethJpy") &&
    finite("ethUsd") &&
    finite("swapShortfallEstimateYen") &&
    finite("swapGasEstimateYen") &&
    finite("knownCostEstimateYen") &&
    nullableFinite("providerL1FeeEstimateYen") &&
    nullableFinite("providerKnownCostEstimateYen")
  );
}

export interface BaseCostWindowSummary {
  hours: 24 | 168 | 720;
  expectedObservations: number;
  attemptCount: number;
  observedCount: number;
  /** Observed ÷ attempted, in percent; null before the first attempt. */
  availabilityPercent: number | null;
  /** knownCostEstimateYen as a share of the 500 yen round trip. */
  medianCostPercent: number | null;
  p90CostPercent: number | null;
  maxCostPercent: number | null;
  medianShortfallYen: number | null;
  medianSwapGasYen: number | null;
  /** Observations whose quote carried an L1 fee estimate. */
  l1FeeReportedCount: number;
  medianProviderKnownCostPercent: number | null;
  errorCounts: Partial<Record<BaseCostErrorCode, number>>;
}

export interface BaseCostSummary {
  mode: "paper";
  executionLocked: true;
  requestedYen: typeof BASE_COST_REQUESTED_YEN;
  lastObservedAt: string | null;
  windows: BaseCostWindowSummary[];
  /**
   * The Ethereum mainnet cost model the chart engine uses, for the same yen
   * amount at the latest observed ETH price. A model estimate, not an
   * observation, and without the liquidity term.
   */
  ethereumModelCostPercent: number | null;
  researchOnly: true;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Nearest-rank percentile of an unsorted list; null when empty. */
function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[rank];
}

export function summarizeBaseCost(
  records: BaseCostRecord[],
  nowMs: number,
): BaseCostSummary {
  const ordered = records
    .filter((record) => record.bucketTimeMs <= nowMs)
    .toSorted((left, right) => left.bucketTimeMs - right.bucketTimeMs);
  const observed = ordered.filter(
    (record): record is Extract<BaseCostRecord, { status: "observed" }> =>
      record.status === "observed",
  );
  const latest = observed.at(-1);
  const toPercent = (yen: number) => round((yen / BASE_COST_REQUESTED_YEN) * 100);
  const modelPositionUsd = latest
    ? (BASE_COST_REQUESTED_YEN * latest.ethUsd) / latest.ethJpy
    : null;
  const modelCost =
    modelPositionUsd === null ? null : estimateExecutionCost(modelPositionUsd, null);

  const windows = ([24, 168, 720] as const).map((hours) => {
    const start = nowMs - hours * BASE_COST_BUCKET_MS;
    const scoped = ordered.filter((record) => record.bucketTimeMs > start);
    const scopedObserved = scoped.filter(
      (record): record is Extract<BaseCostRecord, { status: "observed" }> =>
        record.status === "observed",
    );
    const costs = scopedObserved.map((record) => toPercent(record.knownCostEstimateYen));
    const providerCosts = scopedObserved.flatMap((record) =>
      record.providerKnownCostEstimateYen === null
        ? []
        : [toPercent(record.providerKnownCostEstimateYen)],
    );
    const errorCounts: BaseCostWindowSummary["errorCounts"] = {};
    for (const record of scoped) {
      if (record.status === "unavailable") {
        errorCounts[record.errorCode] = (errorCounts[record.errorCode] ?? 0) + 1;
      }
    }
    return {
      hours,
      expectedObservations: hours,
      attemptCount: scoped.length,
      observedCount: scopedObserved.length,
      availabilityPercent: scoped.length
        ? round((scopedObserved.length / scoped.length) * 100, 1)
        : null,
      medianCostPercent: percentile(costs, 0.5),
      p90CostPercent: percentile(costs, 0.9),
      maxCostPercent: costs.length ? Math.max(...costs) : null,
      medianShortfallYen: percentile(
        scopedObserved.map((record) => record.swapShortfallEstimateYen),
        0.5,
      ),
      medianSwapGasYen: percentile(
        scopedObserved.map((record) => record.swapGasEstimateYen),
        0.5,
      ),
      l1FeeReportedCount: scopedObserved.filter(
        (record) => record.providerL1FeeEstimateYen !== null,
      ).length,
      medianProviderKnownCostPercent: percentile(providerCosts, 0.5),
      errorCounts,
    };
  });

  return {
    mode: "paper",
    executionLocked: true,
    requestedYen: BASE_COST_REQUESTED_YEN,
    lastObservedAt: latest?.observedAt ?? null,
    windows,
    ethereumModelCostPercent:
      modelCost && modelPositionUsd
        ? round((modelCost.estimatedRoundTripCostUsd / modelPositionUsd) * 100)
        : null,
    researchOnly: true,
  };
}
