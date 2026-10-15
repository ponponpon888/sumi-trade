import {
  emptyFailureBreakdown,
  failureBreakdownOf,
} from "@/lib/data-source-failure";
import { MAX_ETHEREUM_BLOCK_AGE_SECONDS } from "@/lib/ethereum-preflight-core";
import type {
  ChartModelSnapshot,
  ChartStatus,
  DataSourceCheckResult,
  DataSourceFailureBreakdown,
  DataSourceId,
  DataSourceIncidentItem,
  DataSourceQualityHistoryItem,
  DataSourceQualityItem,
  DataSourceQualitySnapshot,
  OnchainPreflightAssessment,
  PaperDataSourceObservation,
  PortfolioSnapshot,
  PreflightAssessment,
} from "@/lib/types";

export const DATA_SOURCE_HISTORY_MINIMUM_OBSERVATIONS = 12 as const;
/**
 * v2 counts only source-unavailable checks as source failures. policy-blocked and
 * source-stale checks are reported separately and excluded from coverage.
 */
export const DATA_SOURCE_QUALITY_DEFINITION = 2 as const;
const DATA_SOURCE_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1_000;
const DATA_SOURCE_IDS: DataSourceId[] = [
  "blockscout",
  "dexscreener",
  "geckoterminal",
  "ethereum-rpc",
  "kyberswap",
];

const SCAN_INTERVAL_MS = 5 * 60_000;

/**
 * The part of a scan that the 24h source statistics read.
 *
 * A full PaperScanRecord satisfies it, and so does the slim per-bucket row the
 * derived store keeps. That is what lets the 24h window outlive the raw records
 * it used to be computed from.
 */
export type DataSourceQualityObservationRow = {
  bucketTimeMs: number;
  dataSourceQuality?: PaperDataSourceObservation[];
};

type TimedQuality = { status: DataSourceQualityItem["status"]; bucketTimeMs: number };
type SlotObservation = TimedQuality & {
  coveragePercent: number;
  failureBreakdown: DataSourceFailureBreakdown;
};

const SUCCESS: DataSourceCheckResult = { outcome: "success" };
const POLICY_BLOCKED: DataSourceCheckResult = { outcome: "policy-blocked" };
const SOURCE_STALE: DataSourceCheckResult = { outcome: "source-stale" };

/**
 * Classifies a chart analysis built from a successful OHLCV response. After a
 * successful fetch, analyzeChart returns "unavailable" only for a stale latest candle.
 */
export function fetchedChartSourceCheck(status: ChartStatus): DataSourceCheckResult {
  if (status === "ready") return SUCCESS;
  if (status === "insufficient") return POLICY_BLOCKED;
  return SOURCE_STALE;
}

export function quoteSourceCheck(quote: PreflightAssessment): DataSourceCheckResult {
  if (quote.status === "pass") return SUCCESS;
  if (quote.status === "blocked") return POLICY_BLOCKED;
  return { outcome: "source-unavailable", failureKind: quote.failureKind ?? "other" };
}

/** Uses structured fields only; the free-text reasons are never parsed. */
export function onchainSourceCheck(
  assessment: OnchainPreflightAssessment,
): DataSourceCheckResult {
  if (assessment.status === "pass") return SUCCESS;
  if (assessment.status === "unavailable") {
    return { outcome: "source-unavailable", failureKind: assessment.failureKind ?? "other" };
  }
  if (assessment.chainId !== 1) {
    return { outcome: "source-unavailable", failureKind: "other" };
  }
  if (
    assessment.blockAgeSeconds !== null &&
    assessment.blockAgeSeconds > MAX_ETHEREUM_BLOCK_AGE_SECONDS
  ) {
    return SOURCE_STALE;
  }
  if (assessment.contractCodePresent === false) return POLICY_BLOCKED;
  // Any other blocked state (for example a future block timestamp) is treated as a source problem.
  return { outcome: "source-unavailable", failureKind: "other" };
}

function trailingConsecutiveCount(
  observations: TimedQuality[],
  status: TimedQuality["status"],
): number {
  let count = 0;
  let nextTime: number | undefined;
  for (const observation of observations.toReversed()) {
    if (observation.status !== status) break;
    if (nextTime !== undefined && nextTime - observation.bucketTimeMs !== SCAN_INTERVAL_MS) break;
    count += 1;
    nextTime = observation.bucketTimeMs;
  }
  return count;
}

function isCurrentDefinition(observation: PaperDataSourceObservation): boolean {
  return observation.qualityDefinition === DATA_SOURCE_QUALITY_DEFINITION;
}

function maxBreakdown(
  left: DataSourceFailureBreakdown,
  right: DataSourceFailureBreakdown,
): DataSourceFailureBreakdown {
  return {
    rateLimited: Math.max(left.rateLimited, right.rateLimited),
    timeout: Math.max(left.timeout, right.timeout),
    httpError: Math.max(left.httpError, right.httpError),
    parseError: Math.max(left.parseError, right.parseError),
    other: Math.max(left.other, right.other),
  };
}

function uniqueSourceObservations(
  records: DataSourceQualityObservationRow[],
  source: DataSourceId,
  currentDefinitionOnly: boolean,
): SlotObservation[] {
  const slots = new Map<number, SlotObservation>();
  const severity = { healthy: 0, degraded: 1, unavailable: 2 };
  for (const record of records) {
    for (const item of record.dataSourceQuality ?? []) {
      if (item.source !== source) continue;
      if (currentDefinitionOnly && !isCurrentDefinition(item)) continue;
      const previous = slots.get(record.bucketTimeMs);
      const breakdown = item.failureBreakdown ?? emptyFailureBreakdown();
      slots.set(record.bucketTimeMs, {
        bucketTimeMs: record.bucketTimeMs,
        status: previous && severity[previous.status] > severity[item.status]
          ? previous.status
          : item.status,
        coveragePercent: previous
          ? Math.min(previous.coveragePercent, item.coveragePercent)
          : item.coveragePercent,
        failureBreakdown: previous
          ? maxBreakdown(previous.failureBreakdown, breakdown)
          : breakdown,
      });
    }
  }
  return [...slots.values()].toSorted((left, right) => left.bucketTimeMs - right.bucketTimeMs);
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function qualityItem(
  source: DataSourceId,
  results: readonly DataSourceCheckResult[],
  dataAgeSeconds: number | null,
): DataSourceQualityItem {
  const count = (outcome: DataSourceCheckResult["outcome"]) =>
    results.filter((result) => result.outcome === outcome).length;
  const requestedCount = results.length;
  const successfulCount = count("success");
  const sourceUnavailableCount = count("source-unavailable");
  const sourceStaleCount = count("source-stale");
  const policyBlockedCount = count("policy-blocked");
  // Only fetch outcomes are counted: policy-blocked and source-stale leave the denominator.
  const countedCount = successfulCount + sourceUnavailableCount;
  const coveragePercent = requestedCount === 0
    ? 0
    : countedCount === 0
      ? 100
      : round((successfulCount / countedCount) * 100);
  const status = requestedCount === 0 || sourceUnavailableCount === requestedCount
    ? "unavailable"
    : sourceUnavailableCount > 0
      ? "degraded"
      : "healthy";
  const reasons = requestedCount === 0
    ? ["今回のスキャンでは検査対象がありません。"]
    : status === "unavailable"
      ? [`${sourceUnavailableCount}件すべての取得に失敗しました。`]
      : status === "degraded"
        ? [`${sourceUnavailableCount}件の取得に失敗しました。`]
        : policyBlockedCount + sourceStaleCount > 0
          ? [`取得は完了しました。取引条件未達${policyBlockedCount}件・データ鮮度超過${sourceStaleCount}件は障害に含めません。`]
          : ["今回の対象はすべて取得・確認できています。"];

  return {
    source,
    status,
    observedCount: requestedCount,
    successfulCount,
    coveragePercent,
    dataAgeSeconds:
      dataAgeSeconds !== null && Number.isFinite(dataAgeSeconds)
        ? round(Math.max(0, dataAgeSeconds))
        : null,
    reasons,
    qualityDefinition: DATA_SOURCE_QUALITY_DEFINITION,
    requestedCount,
    sourceUnavailableCount,
    sourceStaleCount,
    policyBlockedCount,
    failureBreakdown: failureBreakdownOf(results),
  };
}

function maximumBlockAgeSeconds(
  snapshot: PortfolioSnapshot,
  nowMs: number,
): number | null {
  const ages = snapshot.assets.flatMap((asset) => {
    const timestamp = asset.onchainPreflight?.blockTimestamp;
    if (!timestamp) return [];
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? [(nowMs - parsed) / 1_000] : [];
  });
  return ages.length ? Math.max(...ages) : null;
}

/**
 * Without adapter-recorded checks a missing value cannot be attributed, so it is
 * conservatively counted as a source failure.
 */
function fallbackMarketChecks(snapshot: PortfolioSnapshot): DataSourceCheckResult[] {
  return snapshot.assets
    .filter((asset) => asset.amount > 0)
    .map((asset): DataSourceCheckResult =>
      asset.priceUsd !== null && asset.pairAddress !== null
        ? SUCCESS
        : { outcome: "source-unavailable", failureKind: "other" },
    );
}

function fallbackChartChecks(
  snapshot: PortfolioSnapshot,
  chartModel: ChartModelSnapshot,
): DataSourceCheckResult[] {
  const unattributed: DataSourceCheckResult = { outcome: "source-unavailable", failureKind: "other" };
  const checks = chartModel.analyses.map((analysis) =>
    analysis.status === "ready"
      ? SUCCESS
      : analysis.status === "insufficient"
        ? POLICY_BLOCKED
        : unattributed,
  );
  if (snapshot.assets.some((asset) => asset.symbol === "ETH" && asset.pairAddress)) {
    checks.push(chartModel.ethBenchmark.status === "ready" ? SUCCESS : unattributed);
  }
  return checks;
}

export function assessDataSourceQuality(
  snapshot: PortfolioSnapshot,
  chartModel: ChartModelSnapshot,
  nowMs = Date.now(),
): DataSourceQualitySnapshot {
  const onchain = snapshot.assets.flatMap((asset) =>
    asset.onchainPreflight ? [asset.onchainPreflight] : [],
  );
  const quotes = snapshot.assets.flatMap((asset) =>
    asset.quotePreflight ? [asset.quotePreflight] : [],
  );
  const sources = [
    qualityItem("blockscout", [SUCCESS], 0),
    qualityItem(
      "dexscreener",
      snapshot.sourceChecks?.dexscreener ?? fallbackMarketChecks(snapshot),
      null,
    ),
    qualityItem(
      "geckoterminal",
      chartModel.sourceChecks?.geckoterminal ?? fallbackChartChecks(snapshot, chartModel),
      null,
    ),
    qualityItem(
      "ethereum-rpc",
      onchain.map(onchainSourceCheck),
      maximumBlockAgeSeconds(snapshot, nowMs),
    ),
    qualityItem("kyberswap", quotes.map(quoteSourceCheck), null),
  ];

  return {
    generatedAt: new Date(nowMs).toISOString(),
    status: sources.every((source) => source.status === "healthy")
      ? "healthy"
      : "degraded",
    sources,
    readOnly: true,
  };
}

export function calculateDataSourceQualityHistory(
  records: DataSourceQualityObservationRow[],
  nowMs = Date.now(),
): DataSourceQualityHistoryItem[] {
  const windowStart = nowMs - DATA_SOURCE_HISTORY_WINDOW_MS;
  // Freshness uses all retained observations, including legacy ones; the quality
  // statistics stay 24h-only and use v2 observations only.
  const observations = records.filter((record) => record.bucketTimeMs <= nowMs);

  return DATA_SOURCE_IDS.map((source) => {
    const retainedObservations = uniqueSourceObservations(observations, source, false);
    const sourceObservations = uniqueSourceObservations(observations, source, true).filter(
      (observation) => observation.bucketTimeMs >= windowStart,
    );
    const lastObservedMs = retainedObservations.at(-1)?.bucketTimeMs;
    const lastObservedAt = lastObservedMs === undefined ? null : new Date(lastObservedMs).toISOString();
    const observationAgeSeconds = lastObservedMs === undefined ? null : Math.max(0, (nowMs - lastObservedMs) / 1_000);
    const observationCount = sourceObservations.length;
    const availableCount = sourceObservations.filter(
      (item) => item.status !== "unavailable",
    ).length;
    const availabilityPercent = observationCount
      ? round((availableCount / observationCount) * 100)
      : 0;
    const averageCoveragePercent = observationCount
      ? round(
        sourceObservations.reduce(
          (total, item) => total + item.coveragePercent,
          0,
        ) / observationCount,
      )
      : 0;
    const currentFailureStreak = trailingConsecutiveCount(sourceObservations, "unavailable");
    const failureBreakdown = sourceObservations.reduce(
      (total, item) => ({
        rateLimited: total.rateLimited + item.failureBreakdown.rateLimited,
        timeout: total.timeout + item.failureBreakdown.timeout,
        httpError: total.httpError + item.failureBreakdown.httpError,
        parseError: total.parseError + item.failureBreakdown.parseError,
        other: total.other + item.failureBreakdown.other,
      }),
      emptyFailureBreakdown(),
    );
    const status = observationAgeSeconds !== null && observationAgeSeconds > 15 * 60
      ? "stale"
      : observationCount < DATA_SOURCE_HISTORY_MINIMUM_OBSERVATIONS
      ? "collecting"
      : availabilityPercent >= 95 &&
          averageCoveragePercent >= 90 &&
          currentFailureStreak < 3
        ? "healthy"
        : "degraded";

    return {
      source,
      status,
      observationCount,
      lastObservedAt,
      observationAgeSeconds,
      minimumObservations: DATA_SOURCE_HISTORY_MINIMUM_OBSERVATIONS,
      availabilityPercent,
      averageCoveragePercent,
      currentFailureStreak,
      failureBreakdown,
    };
  });
}

export function calculateDataSourceIncidents(
  records: DataSourceQualityObservationRow[],
  nowMs = Date.now(),
): DataSourceIncidentItem[] {
  const windowStart = nowMs - DATA_SOURCE_HISTORY_WINDOW_MS;
  const observations = records
    .filter(
      (record) =>
        record.bucketTimeMs >= windowStart && record.bucketTimeMs <= nowMs,
    )
    .toSorted((left, right) => left.bucketTimeMs - right.bucketTimeMs);

  return DATA_SOURCE_IDS.map((source) => {
    const sourceObservations = uniqueSourceObservations(observations, source, true);
    let failureStreak = 0;
    let recoveryStreak = 0;
    let incidentOpen = false;
    let incidentCount24h = 0;
    let latestIncidentStartedAt: string | null = null;
    let latestRecoveredAt: string | null = null;

    for (const [index, observation] of sourceObservations.entries()) {
      const previous = sourceObservations[index - 1];
      if (previous && observation.bucketTimeMs - previous.bucketTimeMs !== SCAN_INTERVAL_MS) {
        failureStreak = 0;
        recoveryStreak = 0;
      }
      if (!incidentOpen) {
        failureStreak = observation.status === "unavailable"
          ? failureStreak + 1
          : 0;
        if (failureStreak >= 3) {
          incidentOpen = true;
          incidentCount24h += 1;
          const incidentStart = sourceObservations[index - 2];
          latestIncidentStartedAt = new Date(
            incidentStart?.bucketTimeMs ?? observation.bucketTimeMs,
          ).toISOString();
          recoveryStreak = 0;
        }
        continue;
      }

      recoveryStreak = observation.status === "healthy"
        ? recoveryStreak + 1
        : 0;
      if (recoveryStreak >= 3) {
        incidentOpen = false;
        latestRecoveredAt = new Date(observation.bucketTimeMs).toISOString();
        failureStreak = 0;
      }
    }

    const currentFailureStreak = trailingConsecutiveCount(sourceObservations, "unavailable");
    const currentRecoveryStreak = incidentOpen
      ? trailingConsecutiveCount(sourceObservations, "healthy")
      : 0;

    const status = incidentOpen
      ? "incident"
      : latestRecoveredAt
        ? "recovered"
        : sourceObservations.length < DATA_SOURCE_HISTORY_MINIMUM_OBSERVATIONS
          ? "collecting"
          : "monitoring";

    return {
      source,
      status,
      incidentCount24h,
      currentFailureStreak,
      currentRecoveryStreak,
      latestIncidentStartedAt,
      latestRecoveredAt,
    };
  });
}
