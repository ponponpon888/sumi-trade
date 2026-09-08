import { describe, expect, it } from "vitest";

import {
  assessDataSourceQuality,
  calculateDataSourceQualityHistory,
} from "@/lib/data-source-quality";
import type {
  ChartModelSnapshot,
  DataSourceQualityItem,
  PaperScanRecord,
  PortfolioSnapshot,
} from "@/lib/types";

function fixtures(): {
  snapshot: PortfolioSnapshot;
  chartModel: ChartModelSnapshot;
} {
  const now = "2026-09-08T12:00:00.000Z";
  return {
    snapshot: {
      walletAddress: "0x0000000000000000000000000000000000000001",
      generatedAt: now,
      source: "blockscout+dexscreener",
      totalUsd: 100,
      tradeableUsd: 100,
      blockedUsd: 0,
      gasBalanceEth: 0.01,
      gasBalanceUsd: 25,
      gasReserveEth: 0.005,
      assets: [],
      ignoredTokenCount: 0,
      warnings: [],
    },
    chartModel: {
      generatedAt: now,
      source: "geckoterminal",
      cadenceMinutes: 5,
      requestedAssetCount: 0,
      readyAssetCount: 0,
      analyses: [],
      ethBenchmark: {
        status: "unavailable",
        sparkline: [],
        correlationSeries: [],
      },
      warnings: [],
    },
  };
}

describe("data source quality", () => {
  it("keeps the successful wallet source healthy and marks unobserved sources unavailable", () => {
    const { snapshot, chartModel } = fixtures();
    const quality = assessDataSourceQuality(
      snapshot,
      chartModel,
      Date.parse("2026-09-08T12:00:00.000Z"),
    );

    expect(quality.readOnly).toBe(true);
    expect(quality.status).toBe("degraded");
    expect(quality.sources.find((item) => item.source === "blockscout")).toMatchObject({
      status: "healthy",
      coveragePercent: 100,
    });
    expect(quality.sources.find((item) => item.source === "ethereum-rpc")).toMatchObject({
      status: "unavailable",
      coveragePercent: 0,
    });
  });

  it("reports partial market coverage without changing trade decisions", () => {
    const { snapshot, chartModel } = fixtures();
    snapshot.assets = [
      {
        symbol: "TEST",
        name: "Test",
        contractAddress: "0x0000000000000000000000000000000000000002",
        amount: 1,
        priceUsd: null,
        valueUsd: 0,
        liquidityUsd: null,
        volume24hUsd: null,
        priceChange24h: null,
        tradability: "blocked",
        reason: "市場データなし",
        pairUrl: null,
        pairAddress: null,
        dexId: null,
        contractSafety: null,
        quotePreflight: null,
        onchainPreflight: null,
      },
    ];

    const quality = assessDataSourceQuality(snapshot, chartModel);
    expect(quality.sources.find((item) => item.source === "dexscreener")).toMatchObject({
      status: "degraded",
      observedCount: 1,
      successfulCount: 0,
    });
  });

  function historyRecord(
    bucketTimeMs: number,
    ethereumStatus: DataSourceQualityItem["status"] = "healthy",
  ): PaperScanRecord {
    return {
      schemaVersion: 1,
      id: String(bucketTimeMs),
      bucketTimeMs,
      generatedAt: new Date(bucketTimeMs).toISOString(),
      walletAddress: "0x0000000000000000000000000000000000000001",
      portfolioValueUsd: 100,
      executionLocked: true,
      prices: {},
      signals: [],
      dataSourceQuality: [
        {
          source: "ethereum-rpc",
          status: ethereumStatus,
          coveragePercent: ethereumStatus === "unavailable" ? 0 : 100,
          dataAgeSeconds: ethereumStatus === "unavailable" ? null : 12,
        },
      ],
    };
  }

  it("ignores compatible legacy records without quality observations", () => {
    const nowMs = Date.parse("2026-09-08T12:00:00.000Z");
    const legacy = historyRecord(nowMs - 5 * 60_000);
    delete legacy.dataSourceQuality;

    const ethereum = calculateDataSourceQualityHistory([legacy], nowMs).find(
      (item) => item.source === "ethereum-rpc",
    );

    expect(ethereum).toMatchObject({
      status: "collecting",
      observationCount: 0,
      availabilityPercent: 0,
    });
  });

  it("marks twelve complete observations as stable", () => {
    const nowMs = Date.parse("2026-09-08T12:00:00.000Z");
    const records = Array.from({ length: 12 }, (_, index) =>
      historyRecord(nowMs - (11 - index) * 5 * 60_000),
    );

    const ethereum = calculateDataSourceQualityHistory(records, nowMs).find(
      (item) => item.source === "ethereum-rpc",
    );

    expect(ethereum).toMatchObject({
      status: "healthy",
      observationCount: 12,
      availabilityPercent: 100,
      averageCoveragePercent: 100,
      currentFailureStreak: 0,
    });
  });

  it("reports a trailing three-scan outage as degraded", () => {
    const nowMs = Date.parse("2026-09-08T12:00:00.000Z");
    const records = Array.from({ length: 12 }, (_, index) =>
      historyRecord(
        nowMs - (11 - index) * 5 * 60_000,
        index >= 9 ? "unavailable" : "healthy",
      ),
    );

    const ethereum = calculateDataSourceQualityHistory(records, nowMs).find(
      (item) => item.source === "ethereum-rpc",
    );

    expect(ethereum).toMatchObject({
      status: "degraded",
      observationCount: 12,
      availabilityPercent: 75,
      averageCoveragePercent: 75,
      currentFailureStreak: 3,
    });
  });
});
