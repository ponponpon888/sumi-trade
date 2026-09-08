import type {
  ChartAnalysis,
  ModelDriftSnapshot,
  PortfolioAsset,
  PortfolioRiskAssessment,
  PortfolioSnapshot,
  SignalAction,
  StrategyPlan,
  StrategySignal,
} from "@/lib/types";

interface DraftSignal {
  asset: PortfolioAsset;
  action: SignalAction;
  allocationPercent: number;
  reason: string;
  modelScore: number | null;
  costGatePassed: boolean | null;
}

const DEFAULT_MODEL_DRIFT: ModelDriftSnapshot = {
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
    reasons: ["判定サンプルを収集中"],
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
    reasons: ["判定サンプルを収集中"],
  },
};

function draftSignal(
  asset: PortfolioAsset,
  chartBySymbol: Map<string, ChartAnalysis>,
): DraftSignal {
  if (asset.tradability === "gas") {
    return {
      asset,
      action: "HOLD",
      allocationPercent: 0,
      reason: "ガス残高として固定し、売買には使用しません",
      modelScore: null,
      costGatePassed: null,
    };
  }

  if (asset.tradability === "blocked") {
    return {
      asset,
      action: "BLOCK",
      allocationPercent: 0,
      reason: asset.reason,
      modelScore: null,
      costGatePassed: null,
    };
  }

  if (asset.tradability === "thin") {
    return {
      asset,
      action: "HOLD",
      allocationPercent: 0,
      reason: "市場が薄いため、確定見積もりなしの自動注文を禁止",
      modelScore: null,
      costGatePassed: null,
    };
  }

  const chart = chartBySymbol.get(asset.symbol);
  if (!chart || chart.status !== "ready") {
    return {
      asset,
      action: "HOLD",
      allocationPercent: 0,
      reason: "チャート履歴が不足しているため、新規注文を停止",
      modelScore: chart?.score ?? null,
      costGatePassed: null,
    };
  }

  if (chart.direction === "SELL") {
    const allocationPercent = chart.score <= 20 ? 50 : chart.score <= 32 ? 35 : 20;
    return {
      asset,
      action: "SELL",
      allocationPercent,
      reason: `複合スコア${chart.score}。紙上で${allocationPercent}%縮小`,
      modelScore: chart.score,
      costGatePassed: true,
    };
  }

  if (asset.contractAddress && asset.contractSafety?.status !== "pass") {
    return {
      asset,
      action: "HOLD",
      allocationPercent: 0,
      reason: asset.contractSafety
        ? `コントラクト安全判定${asset.contractSafety.status.toUpperCase()}。${asset.contractSafety.reasons[0] ?? "新規BUYを停止"}`
        : "コントラクト安全判定がないため新規BUYを停止",
      modelScore: chart.score,
      costGatePassed: false,
    };
  }

  if (asset.contractAddress && asset.quotePreflight?.status !== "pass") {
    return {
      asset,
      action: "HOLD",
      allocationPercent: 0,
      reason: asset.quotePreflight
        ? `双方向見積${asset.quotePreflight.status.toUpperCase()}。${asset.quotePreflight.reasons[0] ?? "新規BUYを停止"}`
        : "BUY／SELL双方向見積がないため新規BUYを停止",
      modelScore: chart.score,
      costGatePassed: false,
    };
  }

  if (asset.contractAddress && asset.onchainPreflight?.status !== "pass") {
    return {
      asset,
      action: "HOLD",
      allocationPercent: 0,
      reason: asset.onchainPreflight
        ? `オンチェーン状態${asset.onchainPreflight.status.toUpperCase()}。${asset.onchainPreflight.reasons[0] ?? "新規BUYを停止"}`
        : "オンチェーン状態確認がないため新規BUYを停止",
      modelScore: chart.score,
      costGatePassed: false,
    };
  }

  if (
    chart.direction === "BUY" &&
    chart.backtest.robustness.status !== "pass"
  ) {
    return {
      asset,
      action: "HOLD",
      allocationPercent: 0,
      reason: `耐久試験${chart.backtest.robustness.status.toUpperCase()}。${chart.backtest.robustness.reasons[0] ?? "新規BUYを停止"}`,
      modelScore: chart.score,
      costGatePassed: false,
    };
  }

  if (chart.direction === "BUY" && chart.risk && !chart.risk.costGatePassed) {
    return {
      asset,
      action: "HOLD",
      allocationPercent: 0,
      reason: `買い条件ですが、期待利益$${chart.risk.expectedGrossProfitUsd.toFixed(2)}に対し往復コスト$${chart.risk.estimatedRoundTripCostUsd.toFixed(2)}のため見送り`,
      modelScore: chart.score,
      costGatePassed: false,
    };
  }

  if (chart.direction === "BUY" && chart.risk) {
    return {
      asset,
      action: "BUY",
      allocationPercent: chart.risk.positionSizePercent,
      reason: `3時間軸が上向き、複合スコア${chart.score}、コスト判定通過`,
      modelScore: chart.score,
      costGatePassed: true,
    };
  }

  return {
    asset,
    action: "HOLD",
    allocationPercent: 0,
    reason: `複合スコア${chart.score}。時間軸の一致を待機`,
    modelScore: chart.score,
    costGatePassed: chart.risk?.costGatePassed ?? null,
  };
}

export function createStrategyPlan(
  snapshot: PortfolioSnapshot,
  chartAnalyses: ChartAnalysis[] = [],
  portfolioRisk: PortfolioRiskAssessment,
  modelDrift: ModelDriftSnapshot = DEFAULT_MODEL_DRIFT,
): StrategyPlan {
  const chartBySymbol = new Map(
    chartAnalyses.map((analysis) => [analysis.symbol, analysis]),
  );
  const drafts = snapshot.assets.map((asset) => {
    const draft = draftSignal(asset, chartBySymbol);
    if (draft.action !== "BUY") return draft;
    if (modelDrift.chart.blockNewBuys) {
      return {
        ...draft,
        action: "HOLD" as const,
        allocationPercent: 0,
        reason: `チャートモデル劣化${modelDrift.chart.status.toUpperCase()}。${modelDrift.chart.reasons[0]}`,
        costGatePassed: false,
      };
    }
    if (!portfolioRisk.blockNewBuys) return draft;
    return {
      ...draft,
      action: "HOLD" as const,
      allocationPercent: 0,
      reason: `ポートフォリオリスク${portfolioRisk.status.toUpperCase()}。${portfolioRisk.reasons[0]}`,
      costGatePassed: false,
    };
  });
  const sellProceeds = drafts
    .filter((draft) => draft.action === "SELL")
    .reduce(
      (total, draft) =>
        total + draft.asset.valueUsd * (draft.allocationPercent / 100),
      0,
    );
  const ethPrice =
    snapshot.gasBalanceEth > 0
      ? snapshot.gasBalanceUsd / snapshot.gasBalanceEth
      : 0;
  const freeEthUsd = Math.max(
    0,
    snapshot.gasBalanceUsd - snapshot.gasReserveEth * ethPrice,
  );
  let buyBudget = sellProceeds + freeEthUsd;

  const signals: StrategySignal[] = drafts.map((draft) => {
    let action = draft.action;
    let allocationPercent = draft.allocationPercent;
    let reason = draft.reason;
    let estimatedUsd = 0;
    if (action === "SELL") {
      estimatedUsd = draft.asset.valueUsd * (draft.allocationPercent / 100);
    }
    if (action === "BUY") {
      const requested = snapshot.totalUsd * (draft.allocationPercent / 100);
      estimatedUsd = Math.min(requested, buyBudget);
      buyBudget -= estimatedUsd;
      if (estimatedUsd < 20) {
        action = "HOLD";
        allocationPercent = 0;
        estimatedUsd = 0;
        reason = "買い条件ですが、売却予定額と余剰ETHが20ドル未満のため待機";
      }
    }

    return {
      symbol: draft.asset.symbol,
      action,
      allocationPercent,
      estimatedUsd,
      reason,
      modelScore: draft.modelScore,
      costGatePassed: draft.costGatePassed,
    };
  });

  const count = (action: SignalAction) =>
    signals.filter((signal) => signal.action === action).length;

  return {
    mode: "paper",
    generatedAt: snapshot.generatedAt,
    cadenceMinutes: 5,
    executionLocked: true,
    portfolioRisk,
    modelDrift,
    signals,
    summary: {
      buyCount: count("BUY"),
      sellCount: count("SELL"),
      holdCount: count("HOLD"),
      blockedCount: count("BLOCK"),
    },
  };
}
