import type {
  ChartModelSnapshot,
  DataSourceId,
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
  const observations = records
    .filter(
      (record) =>
        record.bucketTimeMs >= windowStart && record.bucketTimeMs <= nowMs,
    )
    .toSorted((left, right) => left.bucketTimeMs - right.bucketTimeMs);

  return DATA_SOURCE_IDS.map((source) => {
    const sourceObservations = observations.flatMap((record) =>
      record.dataSourceQuality?.filter((item) => item.source === source) ?? [],
    );
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
    let currentFailureStreak = 0;
    for (const observation of sourceObservations.toReversed()) {
      if (observation.status !== "unavailable") break;
      currentFailureStreak += 1;
    }
    const status = observationCount < DATA_SOURCE_HISTORY_MINIMUM_OBSERVATIONS
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
      minimumObservations: DATA_SOURCE_HISTORY_MINIMUM_OBSERVATIONS,
      availabilityPercent,
      averageCoveragePercent,
      currentFailureStreak,
    };
  });
}
