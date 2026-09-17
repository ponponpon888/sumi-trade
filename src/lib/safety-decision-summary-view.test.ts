import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compareStrategies } from "@/lib/chart-model";
import { createSafetyDecisionSummaryView } from "@/lib/safety-decision-summary-view";
import { applySafetyControlToRisk } from "@/lib/safety-control";
import { createStrategyPlan } from "@/lib/strategy";
import type {
  ChartAnalysis,
  ChartDirection,
  ModelDriftAssessment,
  ModelDriftSnapshot,
  PortfolioAsset,
  PortfolioRiskAssessment,
  PortfolioSnapshot,
  SafetyControlSnapshot,
  StrategyPlan,
  StrategySignal,
} from "@/lib/types";

const PASS_RISK: PortfolioRiskAssessment = {
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
  reasons: ["リスク上限内"],
};

const BLOCKED_RISK: PortfolioRiskAssessment = {
  ...PASS_RISK,
  status: "blocked",
  blockNewBuys: true,
  reasons: ["単一銘柄比率が上限超過", "連敗数が上限到達"],
};

const MONITORING: SafetyControlSnapshot = {
  status: "monitoring",
  emergencyStop: false,
  source: "redis",
  executionLocked: true,
  reason: "永続緊急停止は解除状態です。",
  updatedAt: null,
};

const STOPPED: SafetyControlSnapshot = {
  status: "stopped",
  emergencyStop: true,
  source: "redis",
  executionLocked: true,
  reason: "手動停止",
  updatedAt: "2026-09-08T00:00:00.000Z",
};

const UNAVAILABLE_SAFETY: SafetyControlSnapshot = {
  status: "unavailable",
  emergencyStop: true,
  source: "unavailable",
  executionLocked: true,
  reason: "永続緊急停止の状態を取得できないためFail Closedです。",
  updatedAt: null,
};

function drift(
  model: ModelDriftAssessment["model"],
  status: ModelDriftAssessment["status"],
  reasons: string[] = [`${model} ${status}`],
): ModelDriftAssessment {
  return {
    model,
    status,
    blockNewBuys:
      status === "degraded" || status === "recovering" || status === "unavailable",
    recentDays: 7,
    baselineDays: 23,
    recentSamples: 12,
    baselineSamples: 30,
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
    reasons,
  };
}

function drifts(
  chartStatus: ModelDriftAssessment["status"] = "stable",
  communityStatus: ModelDriftAssessment["status"] = "stable",
): ModelDriftSnapshot {
  return {
    chart: drift("chart", chartStatus),
    "community-trend": drift("community-trend", communityStatus),
  };
}

function signal(
  symbol: string,
  action: StrategySignal["action"],
  reason: string,
): StrategySignal {
  return {
    symbol,
    action,
    allocationPercent: action === "BUY" || action === "SELL" ? 20 : 0,
    estimatedUsd: action === "BUY" || action === "SELL" ? 50 : 0,
    reason,
    modelScore: null,
    costGatePassed: null,
  };
}

function plan(overrides: Partial<StrategyPlan> = {}): StrategyPlan {
  return {
    mode: "paper",
    generatedAt: "2026-09-17T00:00:00.000Z",
    cadenceMinutes: 5,
    executionLocked: true,
    portfolioRisk: PASS_RISK,
    modelDrift: drifts(),
    signals: [signal("PEPE", "BUY", "買い条件"), signal("LINK", "SELL", "縮小")],
    summary: { buyCount: 1, sellCount: 1, holdCount: 0, blockedCount: 0 },
    ...overrides,
  };
}

// Minimal fixtures that let createStrategyPlan produce a real BUY draft.
function asset(symbol: string, overrides: Partial<PortfolioAsset> = {}): PortfolioAsset {
  return {
    symbol,
    name: symbol,
    contractAddress: "0x0000000000000000000000000000000000000001",
    amount: 1_000,
    priceUsd: 1,
    valueUsd: 1_000,
    liquidityUsd: 500_000,
    volume24hUsd: 50_000,
    priceChange24h: 0,
    tradability: "eligible",
    reason: "eligible",
    pairUrl: null,
    pairAddress: null,
    dexId: null,
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
    onchainPreflight: {
      status: "pass",
      readOnly: true,
      chainId: 1,
      blockNumber: 25_000_000,
      blockTimestamp: "2026-09-08T00:00:00.000Z",
      blockAgeSeconds: 12,
      contractCodePresent: true,
      checkedAt: "2026-09-08T00:00:12.000Z",
      reasons: ["test"],
    },
    ...overrides,
  };
}

function chart(symbol: string, direction: ChartDirection): ChartAnalysis {
  return {
    symbol,
    status: "ready",
    direction,
    score: direction === "BUY" ? 75 : 25,
    confidence: 50,
    summary: "test",
    reasons: [],
    lastPrice: 1,
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
      tradeCount: 4,
      winRate: 50,
      netReturnPercent: 2,
      maxDrawdownPercent: 1,
      profitFactor: 1.5,
    },
  };
}

function snapshot(assets: PortfolioAsset[]): PortfolioSnapshot {
  return {
    walletAddress: "0x0000000000000000000000000000000000000001",
    generatedAt: "2026-09-17T00:00:00.000Z",
    source: "blockscout+dexscreener",
    totalUsd: assets.reduce((sum, item) => sum + item.valueUsd, 0),
    tradeableUsd: assets.reduce((sum, item) => sum + item.valueUsd, 0),
    blockedUsd: 0,
    gasBalanceEth: 1,
    gasBalanceUsd: 2_500,
    gasReserveEth: 0.005,
    assets,
    ignoredTokenCount: 0,
    warnings: [],
  };
}

function realPlan(
  risk: PortfolioRiskAssessment,
  modelDrift: ModelDriftSnapshot = drifts(),
): StrategyPlan {
  return createStrategyPlan(
    snapshot([
      asset("PEPE"),
      asset("SHIB"),
      asset("SCAM", { tradability: "blocked", reason: "詐欺トークン判定" }),
    ]),
    [chart("PEPE", "BUY"), chart("SHIB", "BUY")],
    risk,
    modelDrift,
  );
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("createSafetyDecisionSummaryView", () => {
  it("reports no observed blockers for a normal plan", () => {
    const view = createSafetyDecisionSummaryView({ plan: plan(), safetyControl: MONITORING });
    expect(view).toEqual({
      displayOnly: true,
      permissionAsserted: false,
      mode: "paper",
      executionLocked: true,
      summaryState: "no-blockers-observed",
      globalBuyBlockers: [],
      assetBuyLimitations: [],
      assetsStoppedByGlobalGate: [],
      rotationLimitations: [],
      indeterminateInputs: [],
      assetCounts: {
        total: 2,
        buy: 1,
        sell: 1,
        hold: 0,
        block: 0,
        stoppedByGlobalGate: 0,
        withBuyLimitation: 0,
      },
      observedAt: "2026-09-17T00:00:00.000Z",
    });
  });

  it("reports chart model drift alone as a global BUY blocker", () => {
    const view = createSafetyDecisionSummaryView({
      plan: plan({ modelDrift: drifts("degraded") }),
      safetyControl: MONITORING,
    });
    expect(view.summaryState).toBe("blockers-observed");
    expect(view.globalBuyBlockers).toEqual([
      {
        origin: "chart-model-drift",
        status: "degraded",
        determinacy: "determinate",
        reasons: ["chart degraded"],
      },
    ]);
  });

  it("reports portfolio risk alone as a global BUY blocker", () => {
    const view = createSafetyDecisionSummaryView({
      plan: plan({ portfolioRisk: BLOCKED_RISK }),
      safetyControl: MONITORING,
    });
    expect(view.summaryState).toBe("blockers-observed");
    expect(view.globalBuyBlockers).toEqual([
      {
        origin: "portfolio-risk",
        status: "blocked",
        determinacy: "determinate",
        safetyControlApplied: false,
        safetyControlReason: null,
        reasons: ["単一銘柄比率が上限超過", "連敗数が上限到達"],
      },
    ]);
  });

  it("orders chart model drift before portfolio risk", () => {
    const view = createSafetyDecisionSummaryView({
      plan: plan({ portfolioRisk: BLOCKED_RISK, modelDrift: drifts("recovering") }),
      safetyControl: MONITORING,
    });
    expect(view.globalBuyBlockers.map((blocker) => blocker.origin)).toEqual([
      "chart-model-drift",
      "portfolio-risk",
    ]);
  });

  it("does not double count a safety control already composed into portfolio risk", () => {
    const composed = applySafetyControlToRisk(BLOCKED_RISK, STOPPED);
    const view = createSafetyDecisionSummaryView({
      plan: plan({ portfolioRisk: composed }),
      safetyControl: STOPPED,
    });
    expect(view.globalBuyBlockers).toEqual([
      {
        origin: "portfolio-risk",
        status: "blocked",
        determinacy: "determinate",
        safetyControlApplied: true,
        safetyControlReason: "手動停止",
        reasons: ["単一銘柄比率が上限超過", "連敗数が上限到達"],
      },
    ]);
    expect(view.indeterminateInputs).toEqual([]);
  });

  it.each([MONITORING, STOPPED, UNAVAILABLE_SAFETY])(
    "matches the applySafetyControlToRisk composition condition for $status",
    (safetyControl) => {
      const composed = applySafetyControlToRisk(PASS_RISK, safetyControl);
      const actuallyComposed = composed !== PASS_RISK;
      const view = createSafetyDecisionSummaryView({
        plan: plan({ portfolioRisk: composed }),
        safetyControl,
      });
      const riskBlocker = view.globalBuyBlockers.find(
        (blocker) => blocker.origin === "portfolio-risk",
      );
      if (!actuallyComposed) {
        expect(riskBlocker).toBeUndefined();
        expect(view.summaryState).toBe("no-blockers-observed");
        return;
      }
      expect(riskBlocker).toEqual({
        origin: "portfolio-risk",
        status: composed.status,
        determinacy: composed.status === "unavailable" ? "indeterminate" : "determinate",
        safetyControlApplied: true,
        safetyControlReason: safetyControl.reason,
        reasons: ["リスク上限内"],
      });
      expect(view.indeterminateInputs).toEqual([]);
    },
  );

  it("does not treat emergencyStop alone as the composition condition", () => {
    const view = createSafetyDecisionSummaryView({
      plan: plan(),
      safetyControl: { ...MONITORING, emergencyStop: true },
    });
    expect(view.globalBuyBlockers).toEqual([]);
    expect(view.indeterminateInputs).toEqual([]);
  });

  it("keeps a safety control that the plan does not show as composed visible", () => {
    const view = createSafetyDecisionSummaryView({
      plan: plan(),
      safetyControl: STOPPED,
    });
    expect(view.globalBuyBlockers).toEqual([]);
    expect(view.indeterminateInputs).toMatchObject([
      { origin: "safety-control", scope: "normal-buy", status: "stopped", reasons: ["手動停止"] },
    ]);
    expect(view.summaryState).toBe("indeterminate");
  });

  it("moves signals converted by portfolio risk to assetsStoppedByGlobalGate", () => {
    const composed = applySafetyControlToRisk(BLOCKED_RISK, STOPPED);
    const strategyPlan = realPlan(composed);
    expect(strategyPlan.signals.map((item) => item.action)).toEqual(["HOLD", "HOLD", "BLOCK"]);
    const view = createSafetyDecisionSummaryView({ plan: strategyPlan, safetyControl: STOPPED });
    expect(view.assetsStoppedByGlobalGate).toEqual(["PEPE", "SHIB"]);
    expect(view.assetBuyLimitations).toEqual([
      { symbol: "SCAM", action: "BLOCK", reason: "詐欺トークン判定" },
    ]);
    expect(view.assetCounts).toMatchObject({ stoppedByGlobalGate: 2, withBuyLimitation: 1 });
  });

  it("moves signals converted by chart model drift to assetsStoppedByGlobalGate", () => {
    const strategyPlan = realPlan(BLOCKED_RISK, drifts("degraded"));
    const view = createSafetyDecisionSummaryView({ plan: strategyPlan, safetyControl: MONITORING });
    expect(view.assetsStoppedByGlobalGate).toEqual(["PEPE", "SHIB"]);
    expect(view.globalBuyBlockers.map((blocker) => blocker.origin)).toEqual([
      "chart-model-drift",
      "portfolio-risk",
    ]);
  });

  it("keeps real BUY signals out of every list when no gate applies", () => {
    const strategyPlan = realPlan(PASS_RISK);
    expect(strategyPlan.signals.map((item) => item.action)).toEqual(["BUY", "BUY", "BLOCK"]);
    const view = createSafetyDecisionSummaryView({ plan: strategyPlan, safetyControl: MONITORING });
    expect(view.assetsStoppedByGlobalGate).toEqual([]);
    expect(view.assetBuyLimitations).toHaveLength(1);
  });

  it("keeps a signal whose reason differs from the template by one character", () => {
    const template = `ポートフォリオリスクBLOCKED。${BLOCKED_RISK.reasons[0]}`;
    const view = createSafetyDecisionSummaryView({
      plan: plan({
        portfolioRisk: BLOCKED_RISK,
        signals: [
          signal("PEPE", "HOLD", template),
          signal("SHIB", "HOLD", `${template}。`),
          signal("DOGE", "BLOCK", template),
        ],
      }),
      safetyControl: MONITORING,
    });
    expect(view.assetsStoppedByGlobalGate).toEqual(["PEPE"]);
    expect(view.assetBuyLimitations).toEqual([
      { symbol: "SHIB", action: "HOLD", reason: `${template}。` },
      { symbol: "DOGE", action: "BLOCK", reason: template },
    ]);
  });

  it("does not match the portfolio risk template while chart drift is the applied gate", () => {
    const template = `ポートフォリオリスクBLOCKED。${BLOCKED_RISK.reasons[0]}`;
    const view = createSafetyDecisionSummaryView({
      plan: plan({
        portfolioRisk: BLOCKED_RISK,
        modelDrift: drifts("degraded"),
        signals: [signal("PEPE", "HOLD", template)],
      }),
      safetyControl: MONITORING,
    });
    expect(view.assetsStoppedByGlobalGate).toEqual([]);
    expect(view.assetBuyLimitations).toEqual([
      { symbol: "PEPE", action: "HOLD", reason: template },
    ]);
  });

  it("lists HOLD and BLOCK reasons verbatim, including the under-20-dollar wait", () => {
    const underTwenty = "買い条件ですが、売却予定額と余剰ETHが20ドル未満のため待機";
    const view = createSafetyDecisionSummaryView({
      plan: plan({
        signals: [
          signal("PEPE", "HOLD", underTwenty),
          signal("SCAM", "BLOCK", "詐欺トークン判定"),
          signal("LINK", "SELL", "縮小"),
        ],
      }),
      safetyControl: MONITORING,
    });
    expect(view.summaryState).toBe("blockers-observed");
    expect(view.assetBuyLimitations).toEqual([
      { symbol: "PEPE", action: "HOLD", reason: underTwenty },
      { symbol: "SCAM", action: "BLOCK", reason: "詐欺トークン判定" },
    ]);
  });

  it("dedupes exact duplicates only within the same origin", () => {
    const view = createSafetyDecisionSummaryView({
      plan: plan({
        portfolioRisk: { ...BLOCKED_RISK, reasons: ["同一理由", "同一理由", "同一理由 "] },
        modelDrift: {
          ...drifts(),
          chart: drift("chart", "degraded", ["同一理由", "同一理由"]),
        },
        signals: [
          signal("PEPE", "HOLD", "待機"),
          signal("PEPE", "HOLD", "待機"),
          signal("SHIB", "HOLD", "待機"),
        ],
      }),
      safetyControl: MONITORING,
    });
    expect(view.globalBuyBlockers.map((blocker) => blocker.reasons)).toEqual([
      ["同一理由"],
      ["同一理由", "同一理由 "],
    ]);
    expect(view.assetBuyLimitations).toEqual([
      { symbol: "PEPE", action: "HOLD", reason: "待機" },
      { symbol: "SHIB", action: "HOLD", reason: "待機" },
    ]);
  });

  it("places community-trend drift only in rotationLimitations", () => {
    const view = createSafetyDecisionSummaryView({
      plan: plan({ modelDrift: drifts("stable", "degraded") }),
      safetyControl: MONITORING,
    });
    expect(view.globalBuyBlockers).toEqual([]);
    expect(view.assetBuyLimitations).toEqual([]);
    expect(view.rotationLimitations).toEqual([
      {
        origin: "community-trend-model-drift",
        scope: "rotation-only",
        status: "degraded",
        determinacy: "determinate",
        label: "コミュニティトレンドの紙上ローテーションを停止中",
        reasons: ["community-trend degraded"],
      },
    ]);
  });

  it("does not report blockers-observed for rotation-only limitations", () => {
    for (const status of ["degraded", "recovering", "unavailable", "collecting"] as const) {
      const view = createSafetyDecisionSummaryView({
        plan: plan({ modelDrift: drifts("stable", status) }),
        safetyControl: MONITORING,
      });
      expect(view.summaryState).toBe("no-blockers-observed");
    }
  });

  it("keeps unavailable inputs as indeterminate blockers", () => {
    const view = createSafetyDecisionSummaryView({
      plan: plan({
        portfolioRisk: applySafetyControlToRisk(PASS_RISK, UNAVAILABLE_SAFETY),
        modelDrift: drifts("unavailable", "unavailable"),
      }),
      safetyControl: UNAVAILABLE_SAFETY,
    });
    expect(view.summaryState).toBe("blockers-observed");
    expect(view.globalBuyBlockers.map((blocker) => [blocker.origin, blocker.determinacy])).toEqual([
      ["chart-model-drift", "indeterminate"],
      ["portfolio-risk", "indeterminate"],
    ]);
    expect(view.rotationLimitations.map((item) => item.determinacy)).toEqual(["indeterminate"]);
    expect(view.indeterminateInputs).toEqual([]);
  });

  it("puts collecting model drift into indeterminateInputs", () => {
    const view = createSafetyDecisionSummaryView({
      plan: plan({ modelDrift: drifts("collecting", "collecting") }),
      safetyControl: MONITORING,
    });
    expect(view.globalBuyBlockers).toEqual([]);
    expect(view.rotationLimitations).toEqual([]);
    expect(view.indeterminateInputs.map((item) => [item.origin, item.scope, item.status])).toEqual([
      ["chart-model-drift", "normal-buy", "collecting"],
      ["community-trend-model-drift", "rotation-only", "collecting"],
    ]);
    expect(view.summaryState).toBe("indeterminate");
  });

  it("applies the summaryState priority order", () => {
    const collecting = drifts("collecting");
    expect(
      createSafetyDecisionSummaryView({
        plan: plan({ modelDrift: collecting, portfolioRisk: BLOCKED_RISK }),
        safetyControl: MONITORING,
      }).summaryState,
    ).toBe("blockers-observed");
    expect(
      createSafetyDecisionSummaryView({
        plan: plan({ modelDrift: collecting, signals: [signal("PEPE", "HOLD", "待機")] }),
        safetyControl: MONITORING,
      }).summaryState,
    ).toBe("blockers-observed");
    expect(
      createSafetyDecisionSummaryView({
        plan: plan({ modelDrift: collecting }),
        safetyControl: MONITORING,
      }).summaryState,
    ).toBe("indeterminate");
    expect(
      createSafetyDecisionSummaryView({
        plan: plan({ modelDrift: drifts("stable", "collecting") }),
        safetyControl: MONITORING,
      }).summaryState,
    ).toBe("no-blockers-observed");
  });

  it("never asserts permission and keeps execution locked", () => {
    const view = createSafetyDecisionSummaryView({ plan: plan(), safetyControl: MONITORING });
    expect(view.permissionAsserted).toBe(false);
    expect(view.executionLocked).toBe(true);
    expect(view.displayOnly).toBe(true);
  });

  it("does not mutate frozen inputs", () => {
    const composed = applySafetyControlToRisk(BLOCKED_RISK, STOPPED);
    const input = deepFreeze({
      plan: realPlan(composed, drifts("collecting", "degraded")),
      safetyControl: STOPPED,
    });
    const before = structuredClone(input);
    expect(() => createSafetyDecisionSummaryView(input)).not.toThrow();
    expect(input).toEqual(before);
  });

  it("returns deep-equal but distinct outputs for the same input", () => {
    const input = {
      plan: realPlan(applySafetyControlToRisk(BLOCKED_RISK, STOPPED), drifts("degraded", "degraded")),
      safetyControl: STOPPED,
    };
    const first = createSafetyDecisionSummaryView(input);
    const second = createSafetyDecisionSummaryView(input);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.globalBuyBlockers).not.toBe(first.globalBuyBlockers);
    expect(second.globalBuyBlockers[0]?.reasons).not.toBe(first.globalBuyBlockers[0]?.reasons);
    expect(second.assetsStoppedByGlobalGate).not.toBe(first.assetsStoppedByGlobalGate);
    expect(first.globalBuyBlockers[0]?.reasons).not.toBe(input.plan.modelDrift.chart.reasons);
  });

  it("has no permission-like output keys", () => {
    const view = createSafetyDecisionSummaryView({
      plan: realPlan(applySafetyControlToRisk(BLOCKED_RISK, STOPPED), drifts("collecting", "degraded")),
      safetyControl: STOPPED,
    });
    const keys = collectKeys(view);
    for (const forbidden of [
      "canBuy",
      "safe",
      "ready",
      "allowed",
      "recommendation",
      "requiredDeposit",
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  describe("implementation source", () => {
    const source = readFileSync(
      new URL("./safety-decision-summary-view.ts", import.meta.url),
      "utf8",
    );

    it.each([
      ".includes(",
      ".startsWith(",
      ".endsWith(",
      ".indexOf(",
      ".search(",
      ".match(",
      ".matchAll(",
      ".replace(",
      "RegExp",
      ".test(",
    ])("does not use partial matching (%s)", (token) => {
      expect(source).not.toContain(token);
    });

    it.each([
      "fetch",
      "process.env",
      "Date.now",
      "new Date",
      "Math.random",
      "setTimeout",
      "setInterval",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "console.",
      "from \"react",
      "from \"next",
      "server-only",
    ])("does not contain impure access (%s)", (token) => {
      expect(source).not.toContain(token);
    });
  });
});
