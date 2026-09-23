import { describe, expect, it } from "vitest";

import { compareStrategies } from "@/lib/chart-model";
import {
  calculateBuyGatePerformance,
  calculateOrderFlowAttribution,
  calculateScoringComparison,
  calculateOperationalReadiness,
  calculateSourceQualityImpact,
  calculateSourceReasonImpact,
  collectPaperTradeOutcomes,
  createPaperScanRecord,
  evaluatePaperJournal,
  MINIMUM_OBSERVATION_HOURS,
  orderFlowFeatures,
} from "@/lib/paper-journal-core";
import type {
  ChartAnalysis,
  ChartModelSnapshot,
  PaperScanRecord,
  PaperQualification,
  PortfolioSnapshot,
  StrategyPlan,
  PaperTradeOutcome,
} from "@/lib/types";

const WALLET = "0x0000000000000000000000000000000000000001";
const PASSING_QUALIFICATION: PaperQualification = {
  minimumSamples: 30,
  samplePassed: true,
  netProfitPassed: true,
  profitFactorPassed: true,
  drawdownPassed: true,
  costCoveragePassed: true,
  overallPassed: true,
};

function analysis(price: number, direction: "BUY" | "SELL"): ChartAnalysis {
  return {
    symbol: "TEST",
    status: "ready",
    direction,
    score: direction === "BUY" ? 76 : 24,
    confidence: 78,
    summary: "test",
    reasons: [],
    lastPrice: price,
    sparkline: [],
    correlationSeries: [],
    timeframes: [],
    regime: {
      regime: "uptrend",
      strategy: "trend-following",
      confidence: 70,
      riskMultiplier: 1,
      reasons: ["test"],
    },
    risk: {
      stopLossPercent: 4,
      takeProfitPercent: 8,
      trailingStopPercent: 3,
      positionSizePercent: 20,
      estimatedRoundTripCostUsd: 2,
      expectedGrossProfitUsd: 16,
      costGatePassed: true,
      execution: {
        mode: "liquidity-aware",
        liquidityUsd: 500_000,
        positionToLiquidityPercent: 0.04,
        estimatedPriceImpactPercent: 0.08,
        estimatedOneWaySlippagePercent: 0.43,
        estimatedGasUsd: 8,
        estimatedSlippageUsd: 1.72,
        estimatedRoundTripCostUsd: 9.72,
        priceImpactGatePassed: true,
      },
    },
    strategyComparison: compareStrategies([]),
    backtest: {
      status: "ready",
      executionModel: "next-open-conservative",
      benchmarkReturnPercent: 1,
      excessReturnPercent: 1,
      expectancyPercent: 0.5,
      tradeSharpeRatio: 1,
      tradeSortinoRatio: 1.2,
      robustness: {
        status: "pass",
        simulationCount: 1_000,
        tradeCount: 8,
        profitablePathRate: 75,
        medianReturnPercent: 4,
        fifthPercentileReturnPercent: -2,
        ninetyFifthPercentileDrawdownPercent: 5,
        riskOfRuinPercent: 0,
        costSensitivity: [
          { multiplier: 1, netReturnPercent: 5 },
          { multiplier: 1.5, netReturnPercent: 3 },
          { multiplier: 2, netReturnPercent: 1 },
        ],
        reasons: ["test"],
      },
      walkForward: {
        status: "ready",
        windowCount: 3,
        profitableWindowRate: 66.7,
        tradeCount: 3,
        netReturnPercent: 1.5,
        maxDrawdownPercent: 1,
      },
      candleCount: 720,
      tradeCount: 5,
      winRate: 60,
      netReturnPercent: 4,
      maxDrawdownPercent: 2,
      profitFactor: 1.5,
    },
  };
}

function data(price: number, direction: "BUY" | "SELL") {
  const snapshot: PortfolioSnapshot = {
    walletAddress: WALLET,
    generatedAt: "2026-09-07T00:00:00.000Z",
    source: "blockscout+dexscreener",
    totalUsd: 1_000,
    tradeableUsd: 1_000,
    blockedUsd: 0,
    gasBalanceEth: 0.01,
    gasBalanceUsd: 25,
    gasReserveEth: 0.005,
    assets: [],
    ignoredTokenCount: 0,
    warnings: [],
  };
  const chartModel: ChartModelSnapshot = {
    generatedAt: snapshot.generatedAt,
    source: "geckoterminal",
    cadenceMinutes: 5,
    requestedAssetCount: 1,
    readyAssetCount: 1,
    ethBenchmark: {
      status: "ready",
      sparkline: Array.from({ length: 20 }, (_, index) => 100 + index),
      correlationSeries: Array.from({ length: 20 }, (_, index) => ({
        timestamp: index * 300,
        price: 100 + index,
      })),
    },
    analyses: [analysis(price, direction)],
    warnings: [],
  };
  const plan: StrategyPlan = {
    mode: "paper",
    generatedAt: snapshot.generatedAt,
    cadenceMinutes: 5,
    executionLocked: true,
    portfolioRisk: {
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
      reasons: ["test"],
    },
    modelDrift: {
      chart: {
        model: "chart",
        status: "collecting",
        blockNewBuys: false,
        recentDays: 7,
        baselineDays: 23,
        recentSamples: 0,
        baselineSamples: 0,
        recentNetPnlUsd: 0,
        recentAverageNetReturnPercent: 0,
        baselineAverageNetReturnPercent: 0,
        averageReturnDropPercentagePoints: 0,
        recentProfitFactor: null,
        baselineProfitFactor: null,
        recoveryConfirmationHours: 12,
        recoveryConfirmationPassed: false,
        limits: {
          minimumRecentSamples: 10,
          minimumBaselineSamples: 20,
          averageReturnDropPercentagePoints: 1.5,
          recentProfitFactor: 0.8,
          baselineProfitFactor: 1.2,
        },
        reasons: ["test"],
      },
      "community-trend": {
        model: "community-trend",
        status: "collecting",
        blockNewBuys: false,
        recentDays: 7,
        baselineDays: 23,
        recentSamples: 0,
        baselineSamples: 0,
        recentNetPnlUsd: 0,
        recentAverageNetReturnPercent: 0,
        baselineAverageNetReturnPercent: 0,
        averageReturnDropPercentagePoints: 0,
        recentProfitFactor: null,
        baselineProfitFactor: null,
        recoveryConfirmationHours: 12,
        recoveryConfirmationPassed: false,
        limits: {
          minimumRecentSamples: 10,
          minimumBaselineSamples: 20,
          averageReturnDropPercentagePoints: 1.5,
          recentProfitFactor: 0.8,
          baselineProfitFactor: 1.2,
        },
        reasons: ["test"],
      },
    },
    signals: [
      {
        symbol: "TEST",
        action: direction,
        allocationPercent: 20,
        estimatedUsd: 200,
        reason: "test",
        modelScore: 76,
        costGatePassed: true,
      },
    ],
    summary: {
      buyCount: direction === "BUY" ? 1 : 0,
      sellCount: direction === "SELL" ? 1 : 0,
      holdCount: 0,
      blockedCount: 0,
    },
  };
  return { snapshot, chartModel, plan };
}

function recordAt(
  hours: number,
  price: number,
  direction: "BUY" | "SELL" | null,
): PaperScanRecord {
  const now = Date.UTC(2026, 8, 7, hours);
  const record = createPaperScanRecord(data(price, direction ?? "BUY"), now);
  return direction ? record : { ...record, signals: [] };
}

function qualityOutcome(
  index: number,
  netReturnPercent: number,
  geckoImpaired: boolean,
): PaperTradeOutcome {
  return {
    decisionId: `quality-${index}`,
    model: "chart",
    priceKey: "TEST",
    symbol: "TEST",
    direction: "BUY",
    entryPriceUsd: 100,
    modelScore: 70,
    confidence: 70,
    decisionReasons: ["EMA alignment"],
    notionalUsd: 100,
    estimatedCostUsd: 1,
    costGatePassed: true,
    signalTime: new Date(Date.UTC(2026, 8, 7, index)).toISOString(),
    outcomeTime: new Date(Date.UTC(2026, 8, 7, index + 6)).toISOString(),
    exitPriceUsd: 100 + netReturnPercent,
    grossReturnPercent: netReturnPercent + 1,
    netReturnPercent,
    netPnlUsd: netReturnPercent,
    won: netReturnPercent > 0,
    entryDataQuality: {
      status: geckoImpaired ? "unavailable" : "complete",
      averageCoveragePercent: geckoImpaired ? 80 : 100,
      degradedSources: [],
      unavailableSources: geckoImpaired ? ["geckoterminal"] : [],
    },
  };
}

describe("paper journal", () => {
  it("creates an execution-locked, five-minute idempotency bucket", () => {
    const first = createPaperScanRecord(data(100, "BUY"), Date.UTC(2026, 8, 7, 0, 1));
    const retry = createPaperScanRecord(data(101, "BUY"), Date.UTC(2026, 8, 7, 0, 4));
    expect(first.id).toBe(retry.id);
    expect(first.generatedAt).not.toBe(retry.generatedAt);
    expect(first.executionLocked).toBe(true);
    expect(first.signals[0]).toMatchObject({
      decisionId: `${first.id}:chart:TEST:BUY`,
      direction: "BUY",
      marketRegime: "uptrend",
      decisionReasons: ["test"],
      notionalUsd: 200,
    });
  });

  it("settles a buy six hours later after subtracting costs", () => {
    const now = Date.UTC(2026, 8, 7, 7);
    const result = evaluatePaperJournal(
      [recordAt(0, 100, "BUY"), recordAt(6, 110, null)],
      now,
    );
    expect(result.maturedCount).toBe(1);
    expect(result.winRate).toBe(100);
    expect(result.netPnlUsd).toBe(18);
    expect(result.executionLocked).toBe(true);
    expect(result.recentOutcomes[0].entryDataQuality).toMatchObject({
      status: "unavailable",
      averageCoveragePercent: 40,
      unavailableSources: ["dexscreener", "ethereum-rpc", "kyberswap"],
    });
    expect(
      result.dataQualityPerformance.find(
        (performance) => performance.band === "unavailable",
      ),
    ).toMatchObject({ maturedCount: 1, netPnlUsd: 18 });
  });

  it("collects settled outcomes for the 30-day audit export", () => {
    const now = Date.UTC(2026, 8, 7, 7);
    const outcomes = collectPaperTradeOutcomes(
      [
        recordAt(-31 * 24, 80, "BUY"),
        recordAt(-31 * 24 + 6, 90, null),
        recordAt(0, 100, "BUY"),
        recordAt(6, 110, null),
      ],
      now,
    );

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ symbol: "TEST", netPnlUsd: 18 });
  });

  it("scores falling prices as a win for a sell signal", () => {
    const now = Date.UTC(2026, 8, 7, 7);
    const result = evaluatePaperJournal(
      [recordAt(0, 100, "SELL"), recordAt(6, 90, null)],
      now,
    );
    expect(result.maturedCount).toBe(1);
    expect(result.netPnlUsd).toBe(18);
  });

  it("deduplicates repeated signals during the six-hour horizon", () => {
    const records = [
      recordAt(0, 100, "BUY"),
      recordAt(1, 101, "BUY"),
      recordAt(6, 110, null),
      recordAt(7, 111, null),
    ];
    const result = evaluatePaperJournal(records, Date.UTC(2026, 8, 7, 8));
    expect(result.signalCount).toBe(1);
    expect(result.maturedCount).toBe(1);
  });

  it("does not qualify a model before thirty matured outcomes", () => {
    const result = evaluatePaperJournal(
      [recordAt(0, 100, "BUY"), recordAt(6, 110, null)],
      Date.UTC(2026, 8, 7, 7),
    );
    expect(result.status).toBe("collecting");
    expect(result.qualification.samplePassed).toBe(false);
    expect(result.qualification.overallPassed).toBe(false);
  });

  it("settles a community-trend paper rotation by contract-address price", () => {
    const address = "0x1111111111111111111111111111111111111111";
    const firstData = data(100, "BUY");
    const trendOnly = {
      ...firstData,
      chartModel: { ...firstData.chartModel, analyses: [] },
      plan: { ...firstData.plan, signals: [] },
      trendScout: {
        generatedAt: new Date(Date.UTC(2026, 8, 7, 0)).toISOString(),
        source: "geckoterminal" as const,
        mode: "shadow" as const,
        executionLocked: true as const,
        candidateCount: 1,
        paperCandidateCount: 1,
        candidates: [{
          rank: 1,
          contractAddress: address,
          pairAddress: "0x2222222222222222222222222222222222222222",
          name: "Trend",
          symbol: "TREND",
          priceUsd: 100,
          liquidityUsd: 2_000_000,
          volume24hUsd: 1_000_000,
          priceChange1h: 2,
          priceChange6h: 8,
          priceChange24h: 15,
          buyers24h: 60,
          sellers24h: 40,
          sentimentPositivePercentage: 75,
          suspiciousReportCount: 0,
          poolAgeDays: 100,
          score: 80,
          decision: "PAPER" as const,
          reasons: [],
          contractSafety: {
            status: "pass" as const,
            source: "blockscout" as const,
            verified: true,
            isContract: true,
            isScam: false,
            isProxy: false,
            implementationAddress: null,
            erc20InterfacePassed: true,
            privilegedFunctions: [],
            reasons: ["test"],
          },
          quotePreflight: {
            status: "pass" as const,
            provider: "kyberswap" as const,
            testAmountUsd: 50,
            buy: null,
            sell: null,
            roundTripRetentionPercent: 99,
            roundTripLossPercent: 1,
            quoteTtlSeconds: 30 as const,
            reasons: ["test"],
          },
        }],
        paperRotation: {
          fromSymbol: "TEST",
          fromContractAddress: WALLET,
          toSymbol: "TREND",
          toContractAddress: address,
          entryPriceUsd: 100,
          amountUsd: 100,
          allocationPercent: 10,
          estimatedRoundTripCostUsd: 2,
          estimatedPriceImpactPercent: 0.01,
          estimatedOneWaySlippagePercent: 0.36,
          costGatePassed: true,
          score: 80,
          executionLocked: true as const,
        },
        warnings: [],
      },
    };
    const entry = createPaperScanRecord(
      trendOnly,
      Date.UTC(2026, 8, 7, 0),
    );
    const exit = createPaperScanRecord(
      {
        ...trendOnly,
        trendScout: {
          ...trendOnly.trendScout,
          candidates: [],
          paperRotation: null,
        },
      },
      Date.UTC(2026, 8, 7, 6),
      { [address]: 110 },
    );
    const result = evaluatePaperJournal(
      [entry, exit],
      Date.UTC(2026, 8, 7, 7),
    );
    expect(result.maturedCount).toBe(0);
    expect(result.modelPerformance["community-trend"].maturedCount).toBe(1);
    expect(result.modelPerformance["community-trend"].netPnlUsd).toBe(8);
    expect(result.modelPerformance["community-trend"].signalCount).toBe(1);
  });

  it("keeps chart and community-trend performance separate", () => {
    const entryTime = Date.UTC(2026, 8, 7, 0);
    const exitTime = Date.UTC(2026, 8, 7, 6);
    const trendAddress = "0x3333333333333333333333333333333333333333";
    const entry: PaperScanRecord = {
      schemaVersion: 1,
      id: "entry",
      bucketTimeMs: entryTime,
      generatedAt: new Date(entryTime).toISOString(),
      walletAddress: WALLET,
      portfolioValueUsd: 1_000,
      executionLocked: true,
      prices: { TEST: 100, [trendAddress]: 100 },
      signals: [
        {
          model: "chart",
          priceKey: "TEST",
          symbol: "TEST",
          direction: "BUY",
          entryPriceUsd: 100,
          modelScore: 75,
          confidence: 80,
          notionalUsd: 200,
          estimatedCostUsd: 2,
          costGatePassed: true,
        },
        {
          model: "community-trend",
          priceKey: trendAddress,
          contractAddress: trendAddress,
          symbol: "TREND",
          direction: "BUY",
          entryPriceUsd: 100,
          modelScore: 82,
          confidence: 82,
          notionalUsd: 100,
          estimatedCostUsd: 2,
          costGatePassed: true,
        },
      ],
    };
    const exit: PaperScanRecord = {
      ...entry,
      id: "exit",
      bucketTimeMs: exitTime,
      generatedAt: new Date(exitTime).toISOString(),
      prices: { TEST: 110, [trendAddress]: 90 },
      signals: [],
    };

    const result = evaluatePaperJournal(
      [entry, exit],
      Date.UTC(2026, 8, 7, 7),
    );

    expect(result.recentOutcomes).toHaveLength(1);
    expect(result.recentOutcomes[0]).toMatchObject({
      model: "chart",
      symbol: "TEST",
    });
    expect(result.netPnlUsd).toBe(18);
    expect(result.modelPerformance.chart).toMatchObject({
      signalCount: 1,
      maturedCount: 1,
      winRate: 100,
      netPnlUsd: 18,
    });
    expect(result.modelPerformance["community-trend"]).toMatchObject({
      signalCount: 1,
      maturedCount: 1,
      winRate: 0,
      netPnlUsd: -12,
    });
    expect(result.periodPerformanceByModel.chart[2]).toMatchObject({
      days: 30,
      maturedCount: 1,
      netPnlUsd: 18,
    });
    expect(result.periodPerformanceByModel["community-trend"][2]).toMatchObject({
      days: 30,
      maturedCount: 1,
      netPnlUsd: -12,
    });
    expect(
      result.dataQualityPerformance.find(
        (performance) => performance.band === "unknown",
      ),
    ).toMatchObject({ maturedCount: 1, netPnlUsd: 18 });
  });

  it("keeps the seven-day promotion window while comparing 24h, 7d, and 30d", () => {
    const now = Date.UTC(2026, 8, 30, 12);
    const pair = (daysAgo: number, entryPrice: number, exitPrice: number) => {
      const entryTime = now - daysAgo * 24 * 60 * 60 * 1_000 - 7 * 60 * 60 * 1_000;
      const entry = createPaperScanRecord(data(entryPrice, "BUY"), entryTime);
      const exit = createPaperScanRecord(
        data(exitPrice, "BUY"),
        entryTime + 6 * 60 * 60 * 1_000,
      );
      return [entry, { ...exit, signals: [] }];
    };
    const records = [
      ...pair(25, 100, 110),
      ...pair(5, 100, 90),
      ...pair(0, 100, 105),
    ];

    const result = evaluatePaperJournal(records, now);

    expect(result.windowDays).toBe(7);
    expect(result.analyticsWindowDays).toBe(30);
    expect(result.maturedCount).toBe(2);
    expect(result.periodPerformance.map((period) => [period.days, period.maturedCount])).toEqual([
      [1, 1],
      [7, 2],
      [30, 3],
    ]);
    expect(result.driftPerformanceByModel.chart).toMatchObject({
      recent: { maturedCount: 2, netPnlUsd: -14 },
      baseline: { maturedCount: 1, netPnlUsd: 18 },
      confirmation: {
        offsetHours: 12,
        recent: { maturedCount: 1 },
        baseline: { maturedCount: 1 },
      },
    });
    expect(
      result.driftPerformanceByModel.chart.recent.maturedCount +
      result.driftPerformanceByModel.chart.baseline.maturedCount,
    ).toBe(3);
    expect(result.assetPerformance[0]).toMatchObject({
      symbol: "TEST",
      maturedCount: 3,
      netPnlUsd: 4,
    });
    expect(result.performanceTimeline).toHaveLength(30);
    expect(result.performanceTimeline.at(-1)?.cumulativeNetPnlUsd).toBe(4);
  });

  it("calculates average wins, losses, and payoff ratio from 30-day outcomes", () => {
    const now = Date.UTC(2026, 8, 8, 12);
    const entries = [
      recordAt(0, 100, "BUY"),
      recordAt(6, 110, null),
      recordAt(7, 100, "BUY"),
      recordAt(13, 95, null),
    ];
    const result = evaluatePaperJournal(entries, now);

    expect(result.averageWinPercent).toBe(9);
    expect(result.averageLossPercent).toBe(-6);
    expect(result.payoffRatio).toBe(1.5);
  });

  it("separates the historical maximum loss streak from the current streak", () => {
    const records = [
      recordAt(0, 100, "BUY"),
      recordAt(6, 90, null),
      recordAt(7, 100, "BUY"),
      recordAt(13, 90, null),
      recordAt(14, 100, "BUY"),
      recordAt(20, 90, null),
      recordAt(21, 100, "BUY"),
      recordAt(27, 110, null),
    ];

    const result = evaluatePaperJournal(
      records,
      Date.UTC(2026, 8, 8, 4),
    );

    expect(result.longestLossStreak).toBe(3);
    expect(result.currentLossStreak).toBe(0);
    expect(result.modelPerformance.chart.currentLossStreak).toBe(0);
  });

  it("attributes a material return gap to the impaired source only after 10 + 10 samples", () => {
    const clean = Array.from({ length: 10 }, (_, index) =>
      qualityOutcome(index, 1.5, false),
    );
    const impaired = Array.from({ length: 10 }, (_, index) =>
      qualityOutcome(index + 10, -1.5, true),
    );
    const legacy = { ...qualityOutcome(21, -20, true), entryDataQuality: undefined };
    const impact = calculateSourceQualityImpact([
      ...clean,
      ...impaired,
      legacy,
    ]);

    expect(impact.find((item) => item.source === "geckoterminal")).toMatchObject({
      status: "performance-alert",
      cleanCount: 10,
      impairedCount: 10,
      cleanAverageNetReturnPercent: 1.5,
      impairedAverageNetReturnPercent: -1.5,
      returnGapPercentagePoints: -3,
      impairedNetPnlUsd: -15,
    });
    expect(impact.find((item) => item.source === "blockscout")).toMatchObject({
      status: "collecting",
      cleanCount: 20,
      impairedCount: 0,
    });
  });

  it("finds the decision reason most affected by a degraded source", () => {
    const clean = Array.from({ length: 5 }, (_, index) => ({
      ...qualityOutcome(index, 2, false),
      decisionReasons: ["EMA alignment", "Shared context"],
    }));
    const impaired = Array.from({ length: 5 }, (_, index) => ({
      ...qualityOutcome(index + 5, -2, true),
      decisionReasons: ["EMA alignment", "Shared context"],
    }));
    const impact = calculateSourceReasonImpact([...clean, ...impaired]);

    expect(impact.find((item) => item.source === "geckoterminal")).toMatchObject({
      status: "performance-alert",
      reason: "EMA alignment",
      cleanCount: 5,
      impairedCount: 5,
      returnGapPercentagePoints: -4,
      impairedNetPnlUsd: -10,
    });
    expect(impact.find((item) => item.source === "blockscout")).toMatchObject({
      status: "collecting",
      impairedCount: 0,
    });
  });
});

describe("paper operational readiness", () => {
  const now = Date.UTC(2026, 8, 8, 12);

  function emptyRecordAt(timestamp: number): PaperScanRecord {
    return {
      ...createPaperScanRecord(data(100, "BUY"), timestamp),
      signals: [],
    };
  }

  it("requires a full seven-day observation period even when model metrics pass", () => {
    const records = [emptyRecordAt(now - 24 * 60 * 60 * 1_000), emptyRecordAt(now)];
    const readiness = calculateOperationalReadiness(
      records,
      now,
      PASSING_QUALIFICATION,
    );

    expect(readiness.observationHours).toBe(24);
    expect(readiness.observationPassed).toBe(false);
    expect(readiness.overallPassed).toBe(false);
    expect(readiness.status).toBe("collecting");
  });

  it("passes only with seven days, healthy 24h coverage, a fresh scan, and model metrics", () => {
    const fiveMinutes = 5 * 60 * 1_000;
    const recentRecords = Array.from({ length: 288 }, (_, index) =>
      emptyRecordAt(now - (287 - index) * fiveMinutes),
    );
    const records = [
      emptyRecordAt(now - MINIMUM_OBSERVATION_HOURS * 60 * 60 * 1_000),
      ...recentRecords,
    ];
    const readiness = calculateOperationalReadiness(
      records,
      now,
      PASSING_QUALIFICATION,
    );

    expect(readiness.observationPassed).toBe(true);
    expect(readiness.scanCoverage24hPercent).toBe(100);
    expect(readiness.scanCoveragePassed).toBe(true);
    expect(readiness.latestScanFresh).toBe(true);
    expect(readiness.overallPassed).toBe(true);
    expect(readiness.status).toBe("ready");
  });

  it("blocks readiness when the latest scan is stale", () => {
    const fiveMinutes = 5 * 60 * 1_000;
    const records = [
      emptyRecordAt(now - MINIMUM_OBSERVATION_HOURS * 60 * 60 * 1_000),
      ...Array.from({ length: 285 }, (_, index) =>
        emptyRecordAt(now - 15 * 60_000 - (284 - index) * fiveMinutes),
      ),
    ];
    const readiness = calculateOperationalReadiness(
      records,
      now,
      PASSING_QUALIFICATION,
    );

    expect(readiness.scanCoveragePassed).toBe(true);
    expect(readiness.latestScanFresh).toBe(false);
    expect(readiness.status).toBe("blocked");
    expect(readiness.overallPassed).toBe(false);
  });
});

describe("buy gate counterfactuals", () => {
  function gatedData(price: number, buyGate: StrategyPlan["signals"][number]["buyGate"]) {
    const input = data(price, "BUY");
    input.plan.signals[0] = {
      ...input.plan.signals[0],
      action: buyGate === "passed" ? "BUY" : "HOLD",
      estimatedUsd: buyGate === "passed" ? 200 : 0,
      buyGate,
    };
    return input;
  }

  function gateOutcome(
    index: number,
    netReturnPercent: number,
    overrides: Partial<PaperTradeOutcome> = {},
  ): PaperTradeOutcome {
    return {
      ...qualityOutcome(index, netReturnPercent, false),
      decisionId: `gate-${index}`,
      buyGate: "cost-gate",
      ...overrides,
    };
  }

  it("records which gate stopped a chart BUY", () => {
    const now = Date.UTC(2026, 8, 7, 0, 1);
    expect(createPaperScanRecord(gatedData(100, "portfolio-risk"), now).signals[0])
      .toMatchObject({ direction: "BUY", buyGate: "portfolio-risk", notionalUsd: 200 });
    const multi = gatedData(100, "contract-safety");
    multi.plan.signals[0].buyGateFailures = ["contract-safety", "portfolio-risk"];
    expect(createPaperScanRecord(multi, now).signals[0].buyGateFailures)
      .toEqual(["contract-safety", "portfolio-risk"]);
    expect(createPaperScanRecord(gatedData(100, "passed"), now).signals[0].buyGate)
      .toBe("passed");
    expect(createPaperScanRecord(gatedData(100, undefined), now).signals[0].buyGate)
      .toBe("not-in-plan");
    expect(createPaperScanRecord(data(100, "SELL"), now).signals[0].buyGate)
      .toBeUndefined();
  });

  it("scores blocked BUYs alongside the existing journal metrics", () => {
    const entry = createPaperScanRecord(gatedData(100, "cost-gate"), Date.UTC(2026, 8, 7, 0));
    const exit = { ...createPaperScanRecord(gatedData(90, "cost-gate"), Date.UTC(2026, 8, 7, 6)), signals: [] };
    const result = evaluatePaperJournal([entry, exit], Date.UTC(2026, 8, 7, 7));

    expect(result.maturedCount).toBe(1);
    expect(result.buyGatePerformance.find((row) => row.gate === "cost-gate"))
      .toMatchObject({ maturedCount: 1, status: "collecting", netPnlUsd: -22 });
    expect(result.buyGatePerformance.find((row) => row.gate === "passed"))
      .toMatchObject({ maturedCount: 0, status: "baseline" });
  });

  it("keeps a baseline row and only lists gates that have outcomes", () => {
    expect(calculateBuyGatePerformance([]).map((row) => row.gate)).toEqual(["passed"]);
  });

  it("waits for ten outcomes before judging a gate", () => {
    const outcomes = Array.from({ length: 9 }, (_, index) => gateOutcome(index, -3));
    expect(calculateBuyGatePerformance(outcomes)[1]).toMatchObject({
      gate: "cost-gate",
      maturedCount: 9,
      status: "collecting",
      researchOnly: true,
    });
  });

  it("marks a gate protective when its blocked BUYs would have lost money", () => {
    const outcomes = Array.from({ length: 10 }, (_, index) => gateOutcome(index, -2));
    expect(calculateBuyGatePerformance(outcomes)[1]).toMatchObject({
      gate: "cost-gate",
      status: "protective",
      netPnlUsd: -20,
    });
  });

  it("marks a gate as missing profit when its blocked BUYs would have won", () => {
    const outcomes = Array.from({ length: 10 }, (_, index) =>
      gateOutcome(index, 2, { buyGate: "portfolio-risk" }));
    expect(calculateBuyGatePerformance(outcomes)[1]).toMatchObject({
      gate: "portfolio-risk",
      status: "missed-profit",
    });
  });

  it("stays inconclusive when the interval still contains zero", () => {
    const outcomes = Array.from({ length: 10 }, (_, index) =>
      gateOutcome(index, index % 2 ? 0.2 : -0.1));
    expect(calculateBuyGatePerformance(outcomes)[1]).toMatchObject({
      status: "inconclusive",
      independentSampleCount: 10,
    });
  });

  it("does not call a noisy gate with a loss-making average protective", () => {
    // Average -0.8% would have passed a plain average threshold; the interval does not.
    const returns = [-6, 5, -4, 3, -7, 4, -2, 6, -5, -2];
    const row = calculateBuyGatePerformance(
      returns.map((value, index) => gateOutcome(index, value)),
    )[1];
    expect(row.averageNetReturnPercent).toBe(-0.8);
    expect(row.status).toBe("inconclusive");
    expect(row.confidenceLowPercent!).toBeLessThan(0);
    expect(row.confidenceHighPercent!).toBeGreaterThan(0);
  });

  it("treats BUYs from the same scan as one sample", () => {
    const outcomes = Array.from({ length: 12 }, (_, index) =>
      gateOutcome(index, -2, { signalTime: new Date(Date.UTC(2026, 8, 7, index % 3)).toISOString() }));
    expect(calculateBuyGatePerformance(outcomes)[1]).toMatchObject({
      maturedCount: 12,
      independentSampleCount: 3,
      status: "collecting",
    });
  });

  it("judges a gate only on the BUYs it blocked alone", () => {
    const sole = Array.from({ length: 10 }, (_, index) =>
      gateOutcome(index, -2, { buyGateFailures: ["cost-gate"] }));
    const shared = Array.from({ length: 5 }, (_, index) =>
      gateOutcome(20 + index, 5, {
        buyGate: "cost-gate",
        buyGateFailures: ["cost-gate", "portfolio-risk"],
      }));
    const rows = calculateBuyGatePerformance([...sole, ...shared]);
    expect(rows.find((row) => row.gate === "cost-gate")).toMatchObject({
      blockedCount: 15,
      maturedCount: 10,
      status: "protective",
      confidenceLowPercent: -2,
      confidenceHighPercent: -2,
    });
    expect(rows.find((row) => row.gate === "portfolio-risk")).toMatchObject({
      blockedCount: 5,
      maturedCount: 0,
      status: "collecting",
    });
  });

  it("uses the recorded gate alone when all filters passed but the budget stopped the BUY", () => {
    const rows = calculateBuyGatePerformance([
      gateOutcome(0, 1, { buyGate: "budget", buyGateFailures: [] }),
    ]);
    expect(rows.map((row) => [row.gate, row.maturedCount])).toEqual([
      ["passed", 0],
      ["budget", 1],
    ]);
  });

  it("ignores SELL and community-trend outcomes and buckets legacy BUYs as unknown", () => {
    const rows = calculateBuyGatePerformance([
      gateOutcome(0, 1, { direction: "SELL", buyGate: undefined }),
      gateOutcome(1, 1, { model: "community-trend", buyGate: undefined }),
      gateOutcome(2, 1, { buyGate: undefined }),
      gateOutcome(3, 1, { buyGate: "passed" }),
    ]);
    expect(rows.map((row) => [row.gate, row.maturedCount])).toEqual([
      ["passed", 1],
      ["unknown", 1],
    ]);
  });
});

describe("exit-rule scoring", () => {
  const FIVE_MINUTES_MS = 5 * 60 * 1_000;
  const start = Date.UTC(2026, 8, 7, 0);

  function pathRecords(priceAt: (minute: number) => number): PaperScanRecord[] {
    return Array.from({ length: 73 }, (_, step) => {
      const record = createPaperScanRecord(
        data(priceAt(step * 5), "BUY"),
        start + step * FIVE_MINUTES_MS,
      );
      return step === 0 ? record : { ...record, signals: [] };
    });
  }

  it("scores a BUY by its own take-profit alongside the six-hour result", () => {
    const records = pathRecords((minute) =>
      minute === 0 ? 100 : minute < 30 ? 104 : minute === 30 ? 109 : 100);
    const [outcome] = collectPaperTradeOutcomes(records, start + 7 * 60 * 60 * 1_000);

    expect(records[0].signals[0]).toMatchObject({
      stopLossPercent: 4,
      takeProfitPercent: 8,
      trailingStopPercent: 3,
    });
    // Six-hour score: flat price, minus 1% round-trip cost.
    expect(outcome).toMatchObject({ netReturnPercent: -1, netPnlUsd: -2, won: false });
    expect(outcome.barrier).toMatchObject({
      exit: "take-profit",
      exitPriceUsd: 108,
      netReturnPercent: 7,
      netPnlUsd: 14,
      won: true,
      pricePointCount: 71,
    });
    expect(outcome.horizonNetReturnsPercent).toEqual({ h1: -1, h2: -1, h4: -1, h6: -1 });
    // Same path and costs under each registered alternative exit rule.
    expect(outcome.exitVariants).toEqual({
      "hard-stop-only": { exit: "take-profit", netReturnPercent: 7 },
      "trail-after-gain": { exit: "take-profit", netReturnPercent: 7 },
      "trail-at-stop-width": { exit: "take-profit", netReturnPercent: 7 },
    });
  });

  it("leaves short horizons empty when no scan is close enough", () => {
    const records = pathRecords(() => 100).filter(
      (record) => record.bucketTimeMs < start + 50 * 60 * 1_000 ||
        record.bucketTimeMs > start + 80 * 60 * 1_000,
    );
    const [outcome] = collectPaperTradeOutcomes(records, start + 7 * 60 * 60 * 1_000);
    expect(outcome.horizonNetReturnsPercent?.h1).toBeNull();
    expect(outcome.horizonNetReturnsPercent?.h2).toBe(-1);
  });

  function scored(
    index: number,
    fixed: number,
    barrierReturn: number,
    overrides: Partial<PaperTradeOutcome> = {},
  ): PaperTradeOutcome {
    return {
      ...qualityOutcome(index, fixed, false),
      decisionId: `scoring-${index}`,
      barrier: {
        exit: barrierReturn > fixed ? "take-profit" : "stop-loss",
        exitTime: new Date(Date.UTC(2026, 8, 7, index, 30)).toISOString(),
        exitPriceUsd: 100 + barrierReturn,
        grossReturnPercent: barrierReturn + 1,
        netReturnPercent: barrierReturn,
        netPnlUsd: barrierReturn,
        won: barrierReturn > 0,
        pricePointCount: 70,
      },
      horizonNetReturnsPercent: { h1: 0.5, h2: null, h4: fixed, h6: fixed },
      ...overrides,
    };
  }

  it("collects until twenty signals have dense price paths", () => {
    const result = calculateScoringComparison([
      ...Array.from({ length: 19 }, (_, index) => scored(index, -1, 2)),
      scored(19, -1, 2, {
        barrier: { ...scored(19, -1, 2).barrier!, pricePointCount: 10 },
      }),
    ]);
    expect(result).toMatchObject({
      status: "collecting",
      pairedCount: 19,
      sparsePathCount: 1,
    });
  });

  it("reports exit rules better when every signal improves", () => {
    const result = calculateScoringComparison(
      Array.from({ length: 20 }, (_, index) => scored(index, -1, 2)),
    );
    expect(result).toMatchObject({
      status: "barrier-better",
      differenceLowPercent: 3,
      differenceHighPercent: 3,
      exitMix: { "take-profit": 20, "stop-loss": 0, "trailing-stop": 0, horizon: 0 },
      fixedHorizon: { winRate: 0, averageNetReturnPercent: -1 },
      barrier: { winRate: 100, averageNetReturnPercent: 2 },
      researchOnly: true,
    });
  });

  it("reports exit rules worse and stays similar when the gap is noise", () => {
    expect(calculateScoringComparison(
      Array.from({ length: 20 }, (_, index) => scored(index, 1, -2)),
    ).status).toBe("barrier-worse");
    expect(calculateScoringComparison(
      Array.from({ length: 20 }, (_, index) =>
        scored(index, 0, index % 2 ? 1 : -1)),
    ).status).toBe("similar");
  });

  it("summarizes each holding time with the samples that reached it", () => {
    const result = calculateScoringComparison(
      Array.from({ length: 20 }, (_, index) => scored(index, -1, 2)),
    );
    expect(result.horizons.map((row) => [row.horizon, row.maturedCount, row.averageNetReturnPercent]))
      .toEqual([
        ["h1", 20, 0.5],
        ["h2", 0, null],
        ["h4", 20, -1],
        ["h6", 20, -1],
      ]);
  });
});

describe("order flow attribution", () => {
  const flowAsset = {
    symbol: "TEST",
    volume24hUsd: 48_000,
    orderFlow: { buysH1: 30, sellsH1: 10, buysH6: 9, sellsH6: 5, volumeH1Usd: 4_000 },
  } as PortfolioSnapshot["assets"][number];

  it("derives buy share and volume acceleration from the asset's DEX activity", () => {
    expect(orderFlowFeatures(flowAsset)).toEqual({
      buyShareH1: 0.75,
      // Only 14 transactions in six hours: too few to trust a share.
      buyShareH6: null,
      volumeAccelerationH1: 2,
    });
    expect(orderFlowFeatures({ ...flowAsset, orderFlow: null })).toBeUndefined();
  });

  it("attaches the order flow to the chart signal it was observed with", () => {
    const input = data(100, "BUY");
    input.snapshot.assets = [flowAsset];
    const record = createPaperScanRecord(input, Date.UTC(2026, 8, 7));
    expect(record.signals[0].orderFlow).toMatchObject({ buyShareH1: 0.75 });
    expect(createPaperScanRecord(data(100, "BUY"), Date.UTC(2026, 8, 7)).signals[0].orderFlow)
      .toBeUndefined();
  });

  function flowOutcome(
    index: number,
    direction: "BUY" | "SELL",
    buyShareH1: number,
    netReturnPercent: number,
  ): PaperTradeOutcome {
    return {
      ...qualityOutcome(index, netReturnPercent, false),
      decisionId: `flow-${index}`,
      direction,
      orderFlow: { buyShareH1, buyShareH6: null, volumeAccelerationH1: 1 },
      horizonNetReturnsPercent: { h1: netReturnPercent / 2, h2: null, h4: null, h6: netReturnPercent },
    };
  }

  function row(outcomes: PaperTradeOutcome[], feature: string, horizon: string) {
    return calculateOrderFlowAttribution(outcomes).rows.find(
      (item) => item.feature === feature && item.horizon === horizon,
    )!;
  }

  it("widens each row so the whole table keeps a 5% false-alarm rate", () => {
    const result = calculateOrderFlowAttribution([]);
    expect(result.familyConfidence).toBeCloseTo(1 - 0.05 / 6, 4);
    expect(result.rows).toHaveLength(6);
    expect(result.rows.every((item) => item.status === "collecting")).toBe(true);
  });

  it("finds flow that agrees with the signal when it wins more", () => {
    const outcomes = Array.from({ length: 24 }, (_, index) => {
      const agrees = index % 2 === 0;
      return flowOutcome(index, "BUY", agrees ? 0.7 : 0.3, agrees ? 2 + (index % 4) * 0.1 : -2 - (index % 4) * 0.1);
    });
    expect(row(outcomes, "buy-share-h1", "h6")).toMatchObject({
      status: "supports-signal",
      favorableCount: 12,
      unfavorableCount: 12,
    });
  });

  it("mirrors buy share for SELL signals", () => {
    // Sell-dominated flow agrees with a SELL signal.
    const outcomes = Array.from({ length: 24 }, (_, index) => {
      const agrees = index % 2 === 0;
      return flowOutcome(index, "SELL", agrees ? 0.3 : 0.7, agrees ? -2 - (index % 4) * 0.1 : 2 + (index % 4) * 0.1);
    });
    expect(row(outcomes, "buy-share-h1", "h6").status).toBe("contradicts-signal");
  });

  it("leaves balanced flow out of both groups", () => {
    const outcomes = Array.from({ length: 30 }, (_, index) => flowOutcome(index, "BUY", 0.5, 1));
    expect(row(outcomes, "buy-share-h1", "h6")).toMatchObject({
      favorableCount: 0,
      unfavorableCount: 0,
      status: "collecting",
    });
  });
});
