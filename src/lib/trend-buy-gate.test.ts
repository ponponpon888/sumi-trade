import { describe, expect, it } from "vitest";

import { applyTrendBuyGates } from "@/lib/trend-buy-gate";
import type {
  ModelDriftAssessment,
  PortfolioRiskAssessment,
  TrendScoutSnapshot,
} from "@/lib/types";

const risk: PortfolioRiskAssessment = {
  status: "pass",
  blockNewBuys: false,
  maxSingleAssetSymbol: null,
  maxSingleAssetPercent: 0,
  maxEthCorrelation: null,
  maxEthCorrelationSymbol: null,
  maxEthCorrelationSampleCount: null,
  minimumCorrelationSampleCount: null,
  correlationMethod: "timestamp-inner-join",
  highCorrelationPairs: [],
  dailyNetPnlUsd: 0,
  dailyLossPercent: 0,
  longestLossStreak: 0,
  currentLossStreak: 0,
  limits: {
    singleAssetPercent: 35,
    correlatedExposurePercent: 50,
    correlation: 0.85,
    dailyLossPercent: 3,
    lossStreak: 3,
  },
  reasons: ["pass"],
};

function drift(blockNewBuys: boolean): ModelDriftAssessment {
  return {
    model: "community-trend",
    status: blockNewBuys ? "degraded" : "stable",
    blockNewBuys,
    recentDays: 7,
    baselineDays: 30,
    recentSamples: 12,
    baselineSamples: 35,
    recentNetPnlUsd: blockNewBuys ? -20 : 20,
    recentAverageNetReturnPercent: blockNewBuys ? -1 : 0.5,
    baselineAverageNetReturnPercent: 0.7,
    averageReturnDropPercentagePoints: blockNewBuys ? 1.7 : 0.2,
    recentProfitFactor: blockNewBuys ? 0.6 : 1.3,
    baselineProfitFactor: 1.4,
    limits: {
      minimumRecentSamples: 10,
      minimumBaselineSamples: 30,
      averageReturnDropPercentagePoints: 1.5,
      recentProfitFactor: 0.8,
      baselineProfitFactor: 1.2,
    },
    reasons: [blockNewBuys ? "trend degraded" : "stable"],
  };
}

const trendScout: TrendScoutSnapshot = {
  generatedAt: "2026-09-08T00:00:00.000Z",
  source: "geckoterminal",
  mode: "shadow",
  executionLocked: true,
  candidateCount: 1,
  paperCandidateCount: 1,
  candidates: [],
  paperRotation: {
    fromSymbol: "AAA",
    fromContractAddress: "0x0000000000000000000000000000000000000001",
    toSymbol: "BBB",
    toContractAddress: "0x0000000000000000000000000000000000000002",
    entryPriceUsd: 1,
    amountUsd: 10,
    allocationPercent: 2,
    estimatedRoundTripCostUsd: 1,
    estimatedPriceImpactPercent: 0.1,
    estimatedOneWaySlippagePercent: 0.1,
    costGatePassed: true,
    score: 80,
    executionLocked: true,
  },
  warnings: [],
};

describe("community trend BUY gate", () => {
  it("keeps rotation when community trend remains stable", () => {
    expect(applyTrendBuyGates(trendScout, risk, drift(false)).paperRotation).not.toBeNull();
  });

  it("isolates a degraded community trend model", () => {
    const result = applyTrendBuyGates(trendScout, risk, drift(true));

    expect(result.paperRotation).toBeNull();
    expect(result.warnings[0]).toContain("コミュニティトレンド劣化DEGRADED");
  });

  it("keeps the global portfolio gate authoritative", () => {
    const result = applyTrendBuyGates(
      trendScout,
      { ...risk, status: "blocked", blockNewBuys: true, reasons: ["global stop"] },
      drift(false),
    );

    expect(result.paperRotation).toBeNull();
    expect(result.warnings[0]).toContain("ポートフォリオリスクBLOCKED");
  });
});
