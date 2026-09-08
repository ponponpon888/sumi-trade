import { describe, expect, it } from "vitest";

import { assessDataSourceQuality } from "@/lib/data-source-quality";
import type { ChartModelSnapshot, PortfolioSnapshot } from "@/lib/types";

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
});
