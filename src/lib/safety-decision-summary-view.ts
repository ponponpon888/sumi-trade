import type {
  ModelDriftAssessment,
  PortfolioRiskAssessment,
  SafetyControlSnapshot,
  StrategyPlan,
  StrategySignal,
} from "@/lib/types";

// Display-only summary of the safety gates that were already applied to a paper strategy plan.
// 表示専用。この出力を売買判定・実行判定へ戻してはならない。
// summaryState "no-blockers-observed" は、BUY許可・安全・ready のいずれも意味しない。
// 入力から観測できた停止要因がなかった、という表示上の事実だけを表す。

export interface SafetyDecisionSummaryInput {
  plan: StrategyPlan;
  safetyControl: SafetyControlSnapshot;
}

export type SafetyDecisionSummaryState =
  | "blockers-observed"
  | "indeterminate"
  | "no-blockers-observed";

export type SafetyDecisionDeterminacy = "determinate" | "indeterminate";

export interface ChartModelDriftBuyBlocker {
  origin: "chart-model-drift";
  status: ModelDriftAssessment["status"];
  determinacy: SafetyDecisionDeterminacy;
  reasons: string[];
}

export interface PortfolioRiskBuyBlocker {
  origin: "portfolio-risk";
  status: PortfolioRiskAssessment["status"];
  determinacy: SafetyDecisionDeterminacy;
  // True when applySafetyControlToRisk composed the safety control into portfolioRisk
  // and the composed reason was found at reasons[0] by exact match.
  safetyControlApplied: boolean;
  safetyControlReason: string | null;
  // portfolioRisk reasons, excluding the composed safety control reason.
  reasons: string[];
}

// Ordered as createStrategyPlan applies them: chart model drift first, then portfolio risk.
export type GlobalBuyBlocker = ChartModelDriftBuyBlocker | PortfolioRiskBuyBlocker;

export interface AssetBuyLimitation {
  symbol: string;
  action: Extract<StrategySignal["action"], "HOLD" | "BLOCK">;
  // signal.reason copied verbatim. Not parsed or classified.
  reason: string;
}

export interface RotationLimitation {
  origin: "community-trend-model-drift";
  scope: "rotation-only";
  status: ModelDriftAssessment["status"];
  determinacy: SafetyDecisionDeterminacy;
  // Display label only. Not a runtime reason code.
  label: string;
  reasons: string[];
}

export interface IndeterminateInput {
  origin:
    | "chart-model-drift"
    | "community-trend-model-drift"
    | "safety-control";
  scope: "normal-buy" | "rotation-only";
  status: string;
  // Display label only. Not a runtime reason code.
  label: string;
  reasons: string[];
}

export interface SafetyDecisionAssetCounts {
  total: number;
  buy: number;
  sell: number;
  hold: number;
  block: number;
  stoppedByGlobalGate: number;
  withBuyLimitation: number;
}

// 表示専用。売買判定へ戻してはならない。
export interface SafetyDecisionSummaryView {
  displayOnly: true;
  permissionAsserted: false;
  mode: "paper";
  executionLocked: true;
  // "no-blockers-observed" は BUY許可・安全・ready を意味しない。
  summaryState: SafetyDecisionSummaryState;
  globalBuyBlockers: GlobalBuyBlocker[];
  assetBuyLimitations: AssetBuyLimitation[];
  assetsStoppedByGlobalGate: string[];
  rotationLimitations: RotationLimitation[];
  indeterminateInputs: IndeterminateInput[];
  assetCounts: SafetyDecisionAssetCounts;
  observedAt: string;
}

const ROTATION_LIMITATION_LABEL = "コミュニティトレンドの紙上ローテーションを停止中";
const CHART_DRIFT_COLLECTING_LABEL = "チャートモデル劣化判定のサンプル収集中";
const COMMUNITY_DRIFT_COLLECTING_LABEL = "コミュニティトレンドモデル劣化判定のサンプル収集中";
const SAFETY_CONTROL_NOT_COMPOSED_LABEL =
  "安全制御の停止状態がポートフォリオリスクへの合成結果として確認できません";

// Exact-match dedupe inside a single origin. Keeps the first occurrence and the original order.
function uniqueExact(messages: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const message of messages) {
    if (seen.has(message)) continue;
    seen.add(message);
    result.push(message);
  }
  return result;
}

function determinacyOf(status: string): SafetyDecisionDeterminacy {
  return status === "unavailable" ? "indeterminate" : "determinate";
}

// Mirrors the composition condition in applySafetyControlToRisk exactly.
function safetyControlComposes(safetyControl: SafetyControlSnapshot): boolean {
  return safetyControl.status !== "monitoring";
}

// Mirrors the BUY -> HOLD reason templates in createStrategyPlan exactly.
function chartDriftConversionReason(drift: ModelDriftAssessment): string {
  return `チャートモデル劣化${drift.status.toUpperCase()}。${drift.reasons[0]}`;
}

function portfolioRiskConversionReason(risk: PortfolioRiskAssessment): string {
  return `ポートフォリオリスク${risk.status.toUpperCase()}。${risk.reasons[0]}`;
}

function globalGateConversionReason(plan: StrategyPlan): string | null {
  if (plan.modelDrift.chart.blockNewBuys) {
    return chartDriftConversionReason(plan.modelDrift.chart);
  }
  if (plan.portfolioRisk.blockNewBuys) {
    return portfolioRiskConversionReason(plan.portfolioRisk);
  }
  return null;
}

export function createSafetyDecisionSummaryView(
  input: SafetyDecisionSummaryInput,
): SafetyDecisionSummaryView {
  const { plan, safetyControl } = input;
  const chartDrift = plan.modelDrift.chart;
  const communityDrift = plan.modelDrift["community-trend"];
  const risk = plan.portfolioRisk;

  const globalBuyBlockers: GlobalBuyBlocker[] = [];
  const indeterminateInputs: IndeterminateInput[] = [];

  if (chartDrift.blockNewBuys) {
    globalBuyBlockers.push({
      origin: "chart-model-drift",
      status: chartDrift.status,
      determinacy: determinacyOf(chartDrift.status),
      reasons: uniqueExact(chartDrift.reasons),
    });
  } else if (chartDrift.status === "collecting") {
    indeterminateInputs.push({
      origin: "chart-model-drift",
      scope: "normal-buy",
      status: chartDrift.status,
      label: CHART_DRIFT_COLLECTING_LABEL,
      reasons: uniqueExact(chartDrift.reasons),
    });
  }

  const composes = safetyControlComposes(safetyControl);
  const composedReasonFound =
    composes &&
    risk.blockNewBuys &&
    risk.reasons.length > 0 &&
    risk.reasons[0] === safetyControl.reason;

  if (risk.blockNewBuys) {
    globalBuyBlockers.push({
      origin: "portfolio-risk",
      status: risk.status,
      determinacy: determinacyOf(risk.status),
      safetyControlApplied: composedReasonFound,
      safetyControlReason: composedReasonFound ? safetyControl.reason : null,
      reasons: uniqueExact(composedReasonFound ? risk.reasons.slice(1) : risk.reasons),
    });
  }

  if (composes && !composedReasonFound) {
    // The safety control says it composes, but the plan does not show it. Keep it visible
    // instead of dropping it, and do not invent a blocker the plan did not apply.
    indeterminateInputs.push({
      origin: "safety-control",
      scope: "normal-buy",
      status: safetyControl.status,
      label: SAFETY_CONTROL_NOT_COMPOSED_LABEL,
      reasons: [safetyControl.reason],
    });
  }

  const conversionReason = globalGateConversionReason(plan);
  const assetsStoppedByGlobalGate: string[] = [];
  const assetBuyLimitations: AssetBuyLimitation[] = [];
  const seenLimitations = new Map<string, Set<string>>();

  for (const signal of plan.signals) {
    if (signal.action !== "HOLD" && signal.action !== "BLOCK") continue;
    if (
      conversionReason !== null &&
      signal.action === "HOLD" &&
      signal.reason === conversionReason
    ) {
      assetsStoppedByGlobalGate.push(signal.symbol);
      continue;
    }
    const key = JSON.stringify([signal.symbol, signal.action]);
    const seenReasons = seenLimitations.get(key) ?? new Set<string>();
    seenLimitations.set(key, seenReasons);
    if (seenReasons.has(signal.reason)) continue;
    seenReasons.add(signal.reason);
    assetBuyLimitations.push({
      symbol: signal.symbol,
      action: signal.action,
      reason: signal.reason,
    });
  }

  const rotationLimitations: RotationLimitation[] = [];
  if (communityDrift.blockNewBuys) {
    rotationLimitations.push({
      origin: "community-trend-model-drift",
      scope: "rotation-only",
      status: communityDrift.status,
      determinacy: determinacyOf(communityDrift.status),
      label: ROTATION_LIMITATION_LABEL,
      reasons: uniqueExact(communityDrift.reasons),
    });
  } else if (communityDrift.status === "collecting") {
    indeterminateInputs.push({
      origin: "community-trend-model-drift",
      scope: "rotation-only",
      status: communityDrift.status,
      label: COMMUNITY_DRIFT_COLLECTING_LABEL,
      reasons: uniqueExact(communityDrift.reasons),
    });
  }

  const countAction = (action: StrategySignal["action"]) =>
    plan.signals.filter((signal) => signal.action === action).length;

  // Rotation-only limitations and rotation-only indeterminate inputs never affect summaryState.
  const summaryState: SafetyDecisionSummaryState =
    globalBuyBlockers.length > 0 || assetBuyLimitations.length > 0
      ? "blockers-observed"
      : indeterminateInputs.some((item) => item.scope === "normal-buy")
        ? "indeterminate"
        : "no-blockers-observed";

  return {
    displayOnly: true,
    permissionAsserted: false,
    mode: "paper",
    executionLocked: true,
    summaryState,
    globalBuyBlockers,
    assetBuyLimitations,
    assetsStoppedByGlobalGate,
    rotationLimitations,
    indeterminateInputs,
    assetCounts: {
      total: plan.signals.length,
      buy: countAction("BUY"),
      sell: countAction("SELL"),
      hold: countAction("HOLD"),
      block: countAction("BLOCK"),
      stoppedByGlobalGate: assetsStoppedByGlobalGate.length,
      withBuyLimitation: new Set(assetBuyLimitations.map((item) => item.symbol)).size,
    },
    observedAt: plan.generatedAt,
  };
}
