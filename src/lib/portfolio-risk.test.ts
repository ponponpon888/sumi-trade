import { describe, expect, it } from "vitest";

import { compareStrategies } from "@/lib/chart-model";
import { emptyPaperJournal } from "@/lib/paper-journal-core";
import { assessPortfolioRisk, priceCorrelation } from "@/lib/portfolio-risk";
import type {
  ChartAnalysis,
  ChartModelSnapshot,
  PaperJournalSnapshot,
  PortfolioAsset,
  PortfolioSnapshot,
} from "@/lib/types";

function pricesFromReturns(pattern: number[]): number[] {
  return pattern.reduce<number[]>(
    (prices, change) => [...prices, (prices.at(-1) ?? 100) * (1 + change)],
    [100],
  );
}

const rising = pricesFromReturns(Array.from({ length: 19 }, (_, index) =>
  [0.01, -0.005, 0.02, -0.01][index % 4] ?? 0,
));
const alternating = pricesFromReturns(Array.from({ length: 19 }, (_, index) =>
  [0.005, 0.015, -0.01, -0.005][index % 4] ?? 0,
));
const ethIndependent = pricesFromReturns(Array.from({ length: 19 }, (_, index) =>
  [-0.01, 0.02, 0.005, 0.015][index % 4] ?? 0,
));

function asset(symbol: string, valueUsd: number): PortfolioAsset {
  return {
    symbol,
    name: symbol,
    contractAddress: `0x${symbol.charCodeAt(0).toString(16).padStart(40, "0")}`,
    amount: 1,
    priceUsd: valueUsd,
    valueUsd,
    liquidityUsd: 1_000_000,
    volume24hUsd: 100_000,
    priceChange24h: 1,
    tradability: "eligible",
    reason: "test",
    pairUrl: null,
    pairAddress: null,
    dexId: null,
    contractSafety: null,
    quotePreflight: null,
  };
}

function snapshot(values: Array<[string, number]>, totalUsd = 100): PortfolioSnapshot {
  const assets = values.map(([symbol, value]) => asset(symbol, value));
  return {
    walletAddress: "0x0000000000000000000000000000000000000001",
    generatedAt: "2026-09-08T00:00:00.000Z",
    source: "blockscout+dexscreener",
    totalUsd,
    tradeableUsd: assets.reduce((sum, item) => sum + item.valueUsd, 0),
    blockedUsd: 0,
    gasBalanceEth: 0.01,
    gasBalanceUsd: totalUsd - assets.reduce((sum, item) => sum + item.valueUsd, 0),
    gasReserveEth: 0.005,
    assets,
    ignoredTokenCount: 0,
    warnings: [],
  };
}

function analysis(symbol: string, sparkline: number[]): ChartAnalysis {
  return {
    symbol,
    status: "ready",
    direction: "HOLD",
    score: 50,
    confidence: 50,
    summary: "test",
    reasons: [],
    lastPrice: sparkline.at(-1) ?? null,
    sparkline,
    timeframes: [],
    regime: null,
    risk: null,
    strategyComparison: compareStrategies([]),
    backtest: {
      status: "insufficient",
      executionModel: "next-open-conservative",
      candleCount: sparkline.length,
      tradeCount: 0,
      winRate: 0,
      netReturnPercent: 0,
      benchmarkReturnPercent: 0,
      excessReturnPercent: 0,
      expectancyPercent: 0,
      maxDrawdownPercent: 0,
      profitFactor: null,
      tradeSharpeRatio: null,
      tradeSortinoRatio: null,
      robustness: {
        status: "insufficient",
        simulationCount: 0,
        tradeCount: 0,
        profitablePathRate: 0,
        medianReturnPercent: 0,
        fifthPercentileReturnPercent: 0,
        ninetyFifthPercentileDrawdownPercent: 0,
        riskOfRuinPercent: 0,
        costSensitivity: [
          { multiplier: 1, netReturnPercent: 0 },
          { multiplier: 1.5, netReturnPercent: 0 },
          { multiplier: 2, netReturnPercent: 0 },
        ],
        reasons: ["test"],
      },
      walkForward: {
        status: "insufficient",
        windowCount: 0,
        profitableWindowRate: 0,
        tradeCount: 0,
        netReturnPercent: 0,
        maxDrawdownPercent: 0,
      },
    },
  };
}

function chartModel(
  series: Record<string, number[]>,
  ethSeries = ethIndependent,
): ChartModelSnapshot {
  const analyses = Object.entries(series).map(([symbol, values]) =>
    analysis(symbol, values),
  );
  return {
    generatedAt: "2026-09-08T00:00:00.000Z",
    source: "geckoterminal",
    cadenceMinutes: 5,
    requestedAssetCount: analyses.length,
    readyAssetCount: analyses.length,
    ethBenchmark: { status: "ready", sparkline: ethSeries },
    analyses,
    warnings: [],
  };
}

function journal(overrides: Partial<PaperJournalSnapshot> = {}): PaperJournalSnapshot {
  return {
    ...emptyPaperJournal("disabled", "test"),
    status: "collecting",
    storageConfigured: true,
    ...overrides,
  };
}

describe("portfolio risk", () => {
  it("measures return correlation instead of price level", () => {
    expect(priceCorrelation(rising, rising)).toBeCloseTo(1, 3);
    expect(priceCorrelation(rising.slice(0, 8), rising.slice(0, 8))).toBeNull();
  });

  it("passes diversified exposure with complete evidence", () => {
    const result = assessPortfolioRisk(
      snapshot([["AAA", 30], ["BBB", 30]], 100),
      chartModel({ AAA: rising, BBB: alternating }),
      journal(),
    );
    expect(result.status).toBe("pass");
    expect(result.blockNewBuys).toBe(false);
  });

  it("blocks a single asset above 35 percent", () => {
    const result = assessPortfolioRisk(
      snapshot([["AAA", 36]], 100),
      chartModel({ AAA: rising }),
      journal(),
    );
    expect(result.status).toBe("blocked");
    expect(result.reasons.join(" ")).toContain("上限35%超");
  });

  it("blocks correlated assets above 50 percent combined", () => {
    const result = assessPortfolioRisk(
      snapshot([["AAA", 30], ["BBB", 30]], 100),
      chartModel({ AAA: rising, BBB: rising }),
      journal(),
    );
    expect(result.status).toBe("blocked");
    expect(result.highCorrelationPairs[0]).toMatchObject({
      leftSymbol: "AAA",
      rightSymbol: "BBB",
      correlation: 1,
      combinedExposurePercent: 60,
    });
  });

  it("blocks a 25 percent asset that closely follows ETH", () => {
    const result = assessPortfolioRisk(
      snapshot([["AAA", 25]], 100),
      chartModel({ AAA: rising }, rising),
      journal(),
    );
    expect(result.status).toBe("blocked");
    expect(result.reasons.join(" ")).toContain("ETH相関1.00");
  });

  it("blocks after the daily loss limit or three losses", () => {
    const result = assessPortfolioRisk(
      snapshot([["AAA", 20]], 100),
      chartModel({ AAA: rising }),
      journal({ dailyNetPnlUsd: -3, dailyLossPercent: 3, longestLossStreak: 3 }),
    );
    expect(result.status).toBe("blocked");
    expect(result.reasons.join(" ")).toContain("24時間損失3.00%");
    expect(result.reasons.join(" ")).toContain("3連敗");
  });

  it("fails closed when correlation or journal evidence is unavailable", () => {
    const result = assessPortfolioRisk(
      snapshot([["AAA", 20]], 100),
      chartModel({ AAA: rising.slice(0, 8) }),
      emptyPaperJournal("disabled", "test"),
    );
    expect(result.status).toBe("unavailable");
    expect(result.blockNewBuys).toBe(true);
    expect(result.reasons.join(" ")).toContain("相関サンプル不足");
    expect(result.reasons.join(" ")).toContain("24時間損失記録");
  });
});
