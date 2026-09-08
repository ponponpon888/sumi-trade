import { describe, expect, it } from "vitest";

import { compareStrategies } from "@/lib/chart-model";
import {
  calculateOperationalReadiness,
  collectPaperTradeOutcomes,
  createPaperScanRecord,
  evaluatePaperJournal,
  MINIMUM_OBSERVATION_HOURS,
} from "@/lib/paper-journal-core";
import type {
  ChartAnalysis,
  ChartModelSnapshot,
  PaperScanRecord,
  PaperQualification,
  PortfolioSnapshot,
  StrategyPlan,
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
