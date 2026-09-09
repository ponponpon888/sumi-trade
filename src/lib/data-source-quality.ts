import type {
  ChartModelSnapshot,
  DataSourceId,
  DataSourceIncidentItem,
  DataSourceQualityHistoryItem,
  DataSourceQualityItem,
  DataSourceQualitySnapshot,
  PaperScanRecord,
  PortfolioSnapshot,
} from "@/lib/types";

export const DATA_SOURCE_HISTORY_MINIMUM_OBSERVATIONS = 12 as const;
const DATA_SOURCE_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1_000;
const DATA_SOURCE_IDS: DataSourceId[] = [
  "blockscout",
  "dexscreener",
  "geckoterminal",
  "ethereum-rpc",
  "kyberswap",
];

const SCAN_INTERVAL_MS = 5 * 60_000;

type TimedQuality = { status: DataSourceQualityItem["status"]; bucketTimeMs: number };

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

function uniqueSourceObservations(records: PaperScanRecord[], source: DataSourceId) {
  const slots = new Map<number, TimedQuality & { coveragePercent: number }>();
  const severity = { healthy: 0, degraded: 1, unavailable: 2 };
  for (const record of records) {
    for (const item of record.dataSourceQuality ?? []) {
      if (item.source !== source) continue;
      const previous = slots.get(record.bucketTimeMs);
      slots.set(record.bucketTimeMs, {
        bucketTimeMs: record.bucketTimeMs,
        status: previous && severity[previous.status] > severity[item.status]
          ? previous.status
          : item.status,
        coveragePercent: previous
          ? Math.min(previous.coveragePercent, item.coveragePercent)
          : item.coveragePercent,
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
  observedCount: number,
  successfulCount: number,
  dataAgeSeconds: number | null,
): DataSourceQualityItem {
  const safeObserved = Math.max(0, observedCount);
  const safeSuccessful = Math.min(
    safeObserved,
    Math.max(0, successfulCount),
  );
  const coveragePercent = safeObserved
    ? round((safeSuccessful / safeObserved) * 100)
    : 0;
  const status = safeObserved === 0
    ? "unavailable"
    : safeSuccessful === safeObserved
      ? "healthy"
      : "degraded";
  const reasons = status === "unavailable"
    ? ["今回のスキャンでは検査対象がありません。"]
    : status === "degraded"
      ? [`${safeObserved - safeSuccessful}件の取得または安全確認が完了していません。`]
      : ["今回の対象はすべて取得・確認できています。"];

  return {
    source,
    status,
    observedCount: safeObserved,
    successfulCount: safeSuccessful,
    coveragePercent,
    dataAgeSeconds:
      dataAgeSeconds !== null && Number.isFinite(dataAgeSeconds)
        ? round(Math.max(0, dataAgeSeconds))
        : null,
    reasons,
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

export function assessDataSourceQuality(
  snapshot: PortfolioSnapshot,
  chartModel: ChartModelSnapshot,
  nowMs = Date.now(),
): DataSourceQualitySnapshot {
  const marketAssets = snapshot.assets.filter((asset) => asset.amount > 0);
  const marketReady = marketAssets.filter(
    (asset) => asset.priceUsd !== null && asset.pairAddress !== null,
  ).length;
  const chartTargetCount =
    chartModel.requestedAssetCount +
    (snapshot.assets.some((asset) => asset.symbol === "ETH" && asset.pairAddress)
      ? 1
      : 0);
  const chartReadyCount =
    chartModel.readyAssetCount +
    (chartModel.ethBenchmark.status === "ready" ? 1 : 0);
  const onchain = snapshot.assets.flatMap((asset) =>
    asset.onchainPreflight ? [asset.onchainPreflight] : [],
  );
  const quotes = snapshot.assets.flatMap((asset) =>
    asset.quotePreflight ? [asset.quotePreflight] : [],
  );
  const sources = [
    qualityItem("blockscout", 1, 1, 0),
    qualityItem("dexscreener", marketAssets.length, marketReady, null),
    qualityItem(
      "geckoterminal",
      chartTargetCount,
      chartReadyCount,
      null,
    ),
    qualityItem(
      "ethereum-rpc",
      onchain.length,
      onchain.filter((item) => item.status === "pass").length,
      maximumBlockAgeSeconds(snapshot, nowMs),
    ),
    qualityItem(
      "kyberswap",
      quotes.length,
      quotes.filter((item) => item.status === "pass").length,
      null,
    ),
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
  records: PaperScanRecord[],
  nowMs = Date.now(),
): DataSourceQualityHistoryItem[] {
  const windowStart = nowMs - DATA_SOURCE_HISTORY_WINDOW_MS;
  // Freshness uses all retained observations; the quality statistics stay 24h-only.
  const observations = records.filter((record) => record.bucketTimeMs <= nowMs);

  return DATA_SOURCE_IDS.map((source) => {
    const retainedObservations = uniqueSourceObservations(observations, source);
    const sourceObservations = retainedObservations.filter(
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
    };
  });
}

export function calculateDataSourceIncidents(
  records: PaperScanRecord[],
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
    const sourceObservations = uniqueSourceObservations(observations, source);
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
