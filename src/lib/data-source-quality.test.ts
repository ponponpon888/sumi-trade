import { describe, expect, it } from "vitest";

import {
  assessDataSourceQuality,
  calculateDataSourceIncidents,
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

  it("opens an incident after three failures and requires three healthy recoveries", () => {
    const nowMs = Date.parse("2026-09-08T12:00:00.000Z");
    const statuses: DataSourceQualityItem["status"][] = [
      "healthy",
      "healthy",
      "unavailable",
      "unavailable",
      "unavailable",
      "healthy",
      "healthy",
    ];
    const records = statuses.map((status, index) =>
      historyRecord(
        nowMs - (statuses.length - 1 - index) * 5 * 60_000,
        status,
      ),
    );

    const openIncident = calculateDataSourceIncidents(records, nowMs).find(
      (item) => item.source === "ethereum-rpc",
    );
    expect(openIncident).toMatchObject({
      status: "incident",
      incidentCount24h: 1,
      currentRecoveryStreak: 2,
    });

    const recovered = calculateDataSourceIncidents(
      [...records, historyRecord(nowMs + 5 * 60_000, "healthy")],
      nowMs + 5 * 60_000,
    ).find((item) => item.source === "ethereum-rpc");
    expect(recovered).toMatchObject({
      status: "recovered",
      incidentCount24h: 1,
      currentRecoveryStreak: 0,
    });
    expect(recovered?.latestRecoveredAt).not.toBeNull();
  });

  it("does not count partial data as a healthy recovery", () => {
    const nowMs = Date.parse("2026-09-08T12:00:00.000Z");
    const statuses: DataSourceQualityItem["status"][] = [
      "unavailable",
      "unavailable",
      "unavailable",
      "healthy",
      "degraded",
      "healthy",
    ];
    const records = statuses.map((status, index) =>
      historyRecord(
        nowMs - (statuses.length - 1 - index) * 5 * 60_000,
        status,
      ),
    );

    const incident = calculateDataSourceIncidents(records, nowMs).find(
      (item) => item.source === "ethereum-rpc",
    );
    expect(incident).toMatchObject({
      status: "incident",
      currentRecoveryStreak: 1,
    });
  });
  it("does not combine failures across a missing five-minute slot", () => {
    const now = Date.parse("2026-09-09T12:00:00Z");
    const records = [20, 10, 0].map((minutes) => historyRecord(now - minutes * 60_000, "unavailable"));
    expect(calculateDataSourceIncidents(records, now).find((item) => item.source === "ethereum-rpc"))
      .toMatchObject({ status: "collecting", incidentCount24h: 0, currentFailureStreak: 1 });
    expect(calculateDataSourceQualityHistory(records, now).find((item) => item.source === "ethereum-rpc"))
      .toMatchObject({ currentFailureStreak: 1 });
  });

  it("keeps an open incident through missing observations and restarts recovery", () => {
    const start = Date.parse("2026-09-09T10:00:00Z");
    const records = [0, 5, 10].map((minutes) => historyRecord(start + minutes * 60_000, "unavailable"));
    records.push(historyRecord(start + 15 * 60_000), historyRecord(start + 20 * 60_000));
    const missing = historyRecord(start + 25 * 60_000);
    delete missing.dataSourceQuality;
    records.push(missing, historyRecord(start + 30 * 60_000));
    const incident = calculateDataSourceIncidents(records, start + 30 * 60_000).find((item) => item.source === "ethereum-rpc");
    expect(incident).toMatchObject({ status: "incident", incidentCount24h: 1, currentRecoveryStreak: 1, latestRecoveredAt: null });
    records.push(historyRecord(start + 35 * 60_000), historyRecord(start + 40 * 60_000));
    expect(calculateDataSourceIncidents(records, start + 40 * 60_000).find((item) => item.source === "ethereum-rpc"))
      .toMatchObject({ status: "recovered", latestRecoveredAt: new Date(start + 40 * 60_000).toISOString() });
  });

  it("does not treat repeated records in one slot as consecutive failures", () => {
    const now = Date.parse("2026-09-09T12:00:00Z");
    const record = historyRecord(now, "unavailable");
    expect(calculateDataSourceIncidents([record, record, record], now).find((item) => item.source === "ethereum-rpc"))
      .toMatchObject({ incidentCount24h: 0, currentFailureStreak: 1 });
  });

});
