import { describe, expect, it } from "vitest";

import { compareStrategies } from "@/lib/chart-model";
import { createStrategyPlan } from "@/lib/strategy";
import type {
  ChartAnalysis,
  ChartDirection,
  PortfolioAsset,
  PortfolioRiskAssessment,
  PortfolioSnapshot,
} from "@/lib/types";

const PASS_PORTFOLIO_RISK: PortfolioRiskAssessment = {
  status: "pass",
  blockNewBuys: false,
  maxSingleAssetSymbol: "PEPE",
  maxSingleAssetPercent: 20,
  maxEthCorrelation: 0.2,
  maxEthCorrelationSymbol: "PEPE",
  highCorrelationPairs: [],
  dailyNetPnlUsd: 0,
  dailyLossPercent: 0,
  longestLossStreak: 0,
  limits: {
    singleAssetPercent: 35,
    correlatedExposurePercent: 50,
    correlation: 0.85,
    dailyLossPercent: 3,
    lossStreak: 3,
  },
  reasons: ["test"],
};

function asset(overrides: Partial<PortfolioAsset> = {}): PortfolioAsset {
  return {
    symbol: "PEPE",
    name: "Pepe",
    contractAddress: "0x0000000000000000000000000000000000000001",
    amount: 1_000,
    priceUsd: 0.1,
    valueUsd: 100,
    liquidityUsd: 500_000,
    volume24hUsd: 50_000,
    priceChange24h: 0,
    tradability: "eligible",
    reason: "eligible",
    pairUrl: "https://example.com/pair",
    pairAddress: "0x0000000000000000000000000000000000000002",
    dexId: "uniswap",
    contractSafety: {
      status: "pass",
      source: "blockscout",
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
      status: "pass",
      provider: "kyberswap",
      testAmountUsd: 50,
      buy: null,
      sell: null,
      roundTripRetentionPercent: 99,
      roundTripLossPercent: 1,
      quoteTtlSeconds: 30,
      reasons: ["test"],
    },
    ...overrides,
  };
}

function chart(
  direction: ChartDirection,
  overrides: Partial<ChartAnalysis> = {},
): ChartAnalysis {
  return {
    symbol: "PEPE",
    status: "ready",
    direction,
    score: direction === "BUY" ? 75 : direction === "SELL" ? 25 : 50,
    confidence: 50,
    summary: "test",
    reasons: [],
    lastPrice: 0.1,
    sparkline: [],
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
      tradeCount: 4,
      winRate: 50,
      netReturnPercent: 2,
      maxDrawdownPercent: 1,
      profitFactor: 1.5,
    },
    ...overrides,
  };
}

function snapshot(assets: PortfolioAsset[]): PortfolioSnapshot {
  return {
    walletAddress: "0x0000000000000000000000000000000000000001",
    generatedAt: "2026-09-07T00:00:00.000Z",
    source: "blockscout+dexscreener",
    totalUsd: assets.reduce((sum, item) => sum + item.valueUsd, 0),
    tradeableUsd: assets.reduce((sum, item) => sum + item.valueUsd, 0),
    blockedUsd: 0,
    gasBalanceEth: 0.01,
    gasBalanceUsd: 25,
    gasReserveEth: 0.005,
    assets,
    ignoredTokenCount: 0,
    warnings: [],
  };
}

describe("createStrategyPlan", () => {
  it("locks real execution", () => {
    expect(
      createStrategyPlan(snapshot([asset()]), [], PASS_PORTFOLIO_RISK)
        .executionLocked,
    ).toBe(true);
  });

  it("cuts a liquid position when the chart model turns bearish", () => {
    const plan = createStrategyPlan(snapshot([asset()]), [chart("SELL")], PASS_PORTFOLIO_RISK);
    expect(plan.signals[0]).toMatchObject({ action: "SELL", allocationPercent: 35 });
  });

  it("refuses a buy whose gas and slippage erase the expected edge", () => {
    const plan = createStrategyPlan(snapshot([asset()]), [
      chart("BUY", {
        risk: {
          ...chart("BUY").risk!,
          costGatePassed: false,
        },
      }),
    ], PASS_PORTFOLIO_RISK);
    expect(plan.signals[0]).toMatchObject({
      action: "HOLD",
      costGatePassed: false,
    });
  });

  it("blocks a new buy when contract safety needs review", () => {
    const reviewed = asset({
      contractSafety: {
        ...asset().contractSafety!,
        status: "review",
        isProxy: true,
        reasons: ["Proxyで実装変更の可能性あり"],
      },
    });
    const plan = createStrategyPlan(snapshot([reviewed]), [chart("BUY")], PASS_PORTFOLIO_RISK);

    expect(plan.signals[0]).toMatchObject({
      action: "HOLD",
      costGatePassed: false,
    });
  });

  it("keeps the exit path open for a reviewed held contract", () => {
    const reviewed = asset({
      contractSafety: {
        ...asset().contractSafety!,
        status: "review",
        reasons: ["管理関数あり"],
      },
    });
    const plan = createStrategyPlan(snapshot([reviewed]), [chart("SELL")], PASS_PORTFOLIO_RISK);

    expect(plan.signals[0].action).toBe("SELL");
  });

  it("blocks a new buy when the sell-back quote is unavailable", () => {
    const unsellable = asset({
      quotePreflight: {
        ...asset().quotePreflight!,
        status: "blocked",
        sell: null,
        roundTripRetentionPercent: null,
        roundTripLossPercent: null,
        reasons: ["トークン→ETHの売却見積ルートなし"],
      },
    });
    const plan = createStrategyPlan(snapshot([unsellable]), [chart("BUY")], PASS_PORTFOLIO_RISK);

    expect(plan.signals[0]).toMatchObject({
      action: "HOLD",
      costGatePassed: false,
    });
    expect(plan.signals[0].reason).toContain("売却見積ルートなし");
  });

  it("keeps the exit path open when the current quote preflight is blocked", () => {
    const unsellable = asset({
      quotePreflight: {
        ...asset().quotePreflight!,
        status: "blocked",
        reasons: ["現在の売却見積ルートなし"],
      },
    });
    const plan = createStrategyPlan(snapshot([unsellable]), [chart("SELL")], PASS_PORTFOLIO_RISK);

    expect(plan.signals[0].action).toBe("SELL");
  });

  it("blocks a new buy when robustness is under review", () => {
    const weakChart = chart("BUY", {
      backtest: {
        ...chart("BUY").backtest,
        robustness: {
          ...chart("BUY").backtest.robustness,
          status: "review",
          reasons: ["コスト2倍で期待収益が消失"],
        },
      },
    });
    const plan = createStrategyPlan(snapshot([asset()]), [weakChart], PASS_PORTFOLIO_RISK);

    expect(plan.signals[0]).toMatchObject({
      action: "HOLD",
      costGatePassed: false,
    });
    expect(plan.signals[0].reason).toContain("コスト2倍");
  });

  it("keeps the sell path open when robustness is weak", () => {
    const weakChart = chart("SELL", {
      backtest: {
        ...chart("SELL").backtest,
        robustness: {
          ...chart("SELL").backtest.robustness,
          status: "review",
          reasons: ["stress failure"],
        },
      },
    });
    const plan = createStrategyPlan(snapshot([asset()]), [weakChart], PASS_PORTFOLIO_RISK);

    expect(plan.signals[0].action).toBe("SELL");
  });

  it("turns BUY into HOLD when portfolio risk blocks new buys", () => {
    const blockedRisk: PortfolioRiskAssessment = {
      ...PASS_PORTFOLIO_RISK,
      status: "blocked",
      blockNewBuys: true,
      reasons: ["PEPEが全資産の40%で上限35%超"],
    };
    const plan = createStrategyPlan(snapshot([asset()]), [chart("BUY")], blockedRisk);

    expect(plan.signals[0]).toMatchObject({
      action: "HOLD",
      allocationPercent: 0,
      costGatePassed: false,
    });
    expect(plan.signals[0].reason).toContain("ポートフォリオリスクBLOCKED");
  });

  it("keeps SELL available when portfolio risk blocks new buys", () => {
    const blockedRisk: PortfolioRiskAssessment = {
      ...PASS_PORTFOLIO_RISK,
      status: "unavailable",
      blockNewBuys: true,
      reasons: ["ETHベンチマーク履歴なし"],
    };
    const plan = createStrategyPlan(snapshot([asset()]), [chart("SELL")], blockedRisk);

    expect(plan.signals[0]).toMatchObject({
      action: "SELL",
      allocationPercent: 35,
    });
  });

  it("keeps a liquid asset on hold when chart history is absent", () => {
    const plan = createStrategyPlan(snapshot([asset()]), [], PASS_PORTFOLIO_RISK);
    expect(plan.signals[0].action).toBe("HOLD");
  });

  it("never creates an order for blocked assets", () => {
    const plan = createStrategyPlan(
      snapshot([asset({ tradability: "blocked", priceChange24h: 20 })]),
      [chart("BUY")],
      PASS_PORTFOLIO_RISK,
    );
    expect(plan.signals[0].action).toBe("BLOCK");
  });
});
