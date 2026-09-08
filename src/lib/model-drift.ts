import type {
  ModelDriftAssessment,
  ModelDriftSnapshot,
  PaperJournalSnapshot,
  PaperDriftWindowPerformance,
  PaperSignalModel,
} from "@/lib/types";

const MINIMUM_RECENT_SAMPLES = 10 as const;
const MINIMUM_BASELINE_SAMPLES = 20 as const;
const AVERAGE_RETURN_DROP_PERCENTAGE_POINTS = 1.5 as const;
const RECENT_PROFIT_FACTOR_LIMIT = 0.8 as const;
const BASELINE_PROFIT_FACTOR_FLOOR = 1.2 as const;

const limits: ModelDriftAssessment["limits"] = {
  minimumRecentSamples: MINIMUM_RECENT_SAMPLES,
  minimumBaselineSamples: MINIMUM_BASELINE_SAMPLES,
  averageReturnDropPercentagePoints: AVERAGE_RETURN_DROP_PERCENTAGE_POINTS,
  recentProfitFactor: RECENT_PROFIT_FACTOR_LIMIT,
  baselineProfitFactor: BASELINE_PROFIT_FACTOR_FLOOR,
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function result(
  status: ModelDriftAssessment["status"],
  blockNewBuys: boolean,
  model: PaperSignalModel,
  recent: PaperDriftWindowPerformance | undefined,
  baseline: PaperDriftWindowPerformance | undefined,
  reasons: string[],
): ModelDriftAssessment {
  const recentAverage = recent?.averageNetReturnPercent ?? 0;
  const baselineAverage = baseline?.averageNetReturnPercent ?? 0;
  return {
    model,
    status,
    blockNewBuys,
    recentDays: 7,
    baselineDays: 23,
    recentSamples: recent?.maturedCount ?? 0,
    baselineSamples: baseline?.maturedCount ?? 0,
    recentNetPnlUsd: recent?.netPnlUsd ?? 0,
    recentAverageNetReturnPercent: recentAverage,
    baselineAverageNetReturnPercent: baselineAverage,
    averageReturnDropPercentagePoints: round(baselineAverage - recentAverage),
    recentProfitFactor: recent?.profitFactor ?? null,
    baselineProfitFactor: baseline?.profitFactor ?? null,
    limits,
    reasons,
  };
}

export function assessModelDrift(
  journal: PaperJournalSnapshot,
  model: PaperSignalModel,
): ModelDriftAssessment {
  const performance = journal.driftPerformanceByModel[model];
  const recent = performance?.recent;
  const baseline = performance?.baseline;

  if (!journal.storageConfigured || journal.status === "error" || !recent || !baseline) {
    return result(
      "unavailable",
      true,
      model,
      recent,
      baseline,
      ["紙上成績を取得できないため、モデル劣化を安全に判定できません。"],
    );
  }

  const missingSamples: string[] = [];
  if (recent.maturedCount < MINIMUM_RECENT_SAMPLES) {
    missingSamples.push(
      `7日結果 ${recent.maturedCount}/${MINIMUM_RECENT_SAMPLES}件`,
    );
  }
  if (baseline.maturedCount < MINIMUM_BASELINE_SAMPLES) {
    missingSamples.push(
      `直前23日結果 ${baseline.maturedCount}/${MINIMUM_BASELINE_SAMPLES}件`,
    );
  }
  if (missingSamples.length > 0) {
    return result(
      "collecting",
      false,
      model,
      recent,
      baseline,
      [`判定サンプルを収集中: ${missingSamples.join("・")}`],
    );
  }

  const returnDrop = baseline.averageNetReturnPercent - recent.averageNetReturnPercent;
  const recentProfitFactor =
    recent.profitFactor ?? (recent.netPnlUsd < 0 ? 0 : null);
  const returnBreakdown =
    recent.netPnlUsd < 0 &&
    returnDrop >= AVERAGE_RETURN_DROP_PERCENTAGE_POINTS;
  const profitFactorBreakdown =
    recent.netPnlUsd < 0 &&
    baseline.profitFactor !== null &&
    baseline.profitFactor >= BASELINE_PROFIT_FACTOR_FLOOR &&
    recentProfitFactor !== null &&
    recentProfitFactor < RECENT_PROFIT_FACTOR_LIMIT;
  const reasons: string[] = [];

  if (returnBreakdown) {
    reasons.push(
      `直近7日平均リターンが直前23日から${round(returnDrop)}ポイント低下し、7日損益がマイナス`,
    );
  }
  if (profitFactorBreakdown) {
    reasons.push(
      `直前23日PF ${baseline.profitFactor?.toFixed(2)}に対し7日PF ${recentProfitFactor.toFixed(2)}へ低下`,
    );
  }
  if (reasons.length > 0) {
    return result("degraded", true, model, recent, baseline, reasons);
  }

  return result(
    "stable",
    false,
    model,
    recent,
    baseline,
    ["直近7日成績に、直前23日からの重大な劣化は検出されませんでした。"],
  );
}

export function assessModelDrifts(
  journal: PaperJournalSnapshot,
): ModelDriftSnapshot {
  return {
    chart: assessModelDrift(journal, "chart"),
    "community-trend": assessModelDrift(journal, "community-trend"),
  };
}
