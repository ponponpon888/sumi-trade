import { clusteredMeanInterval } from "@/lib/statistics";
import type {
  PaperConfidenceReliability,
  PaperSignalModel,
  PaperTradeOutcome,
} from "@/lib/types";

const MINIMUM_TRAIN_SAMPLES = 20 as const;
const MINIMUM_TEST_SAMPLES = 10 as const;
const FOLD_COUNT = 5;
// Weak pull toward "confidence carries no information" so a small sample
// cannot produce an extreme slope; the tiny intercept penalty keeps the fit
// finite when every training outcome won or lost.
const SLOPE_PENALTY = 1;
const INTERCEPT_PENALTY = 0.01;
const FIT_ITERATIONS = 50;
const DISPLAY_CONFIDENCES = [40, 60, 80, 100] as const;

interface LogisticFit {
  intercept: number;
  slope: number;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function feature(outcome: PaperTradeOutcome): number {
  return Math.max(0, Math.min(100, outcome.confidence)) / 100;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function predict(fit: LogisticFit, x: number): number {
  return sigmoid(fit.intercept + fit.slope * x);
}

/** Platt scaling: penalized logistic regression of a win on confidence. */
export function fitPlattScaling(
  samples: Array<{ x: number; won: boolean }>,
): LogisticFit {
  let intercept = 0;
  let slope = 0;
  for (let iteration = 0; iteration < FIT_ITERATIONS; iteration += 1) {
    let gradientIntercept = -INTERCEPT_PENALTY * intercept;
    let gradientSlope = -SLOPE_PENALTY * slope;
    let hessianAA = INTERCEPT_PENALTY;
    let hessianAB = 0;
    let hessianBB = SLOPE_PENALTY;
    for (const sample of samples) {
      const probability = sigmoid(intercept + slope * sample.x);
      const residual = (sample.won ? 1 : 0) - probability;
      const weight = probability * (1 - probability);
      gradientIntercept += residual;
      gradientSlope += residual * sample.x;
      hessianAA += weight;
      hessianAB += weight * sample.x;
      hessianBB += weight * sample.x * sample.x;
    }
    const determinant = hessianAA * hessianBB - hessianAB * hessianAB;
    if (!(determinant > 0)) break;
    const stepIntercept =
      (hessianBB * gradientIntercept - hessianAB * gradientSlope) / determinant;
    const stepSlope =
      (hessianAA * gradientSlope - hessianAB * gradientIntercept) / determinant;
    intercept += stepIntercept;
    slope += stepSlope;
    if (Math.abs(stepIntercept) + Math.abs(stepSlope) < 1e-9) break;
  }
  return { intercept, slope };
}

/**
 * Walk-forward check of whether confidence predicts a win after costs.
 * Outcomes are cut into time-ordered folds. Each fold is predicted by a Platt
 * fit on earlier outcomes that had already settled when the fold began, and is
 * compared with simply predicting that history's win rate. Confidence counts
 * as informative only when the per-outcome Brier improvement (a
 * Diebold-Mariano style comparison, one sample per scan) is above zero with
 * 95% confidence.
 */
export function calculateConfidenceReliability(
  outcomes: PaperTradeOutcome[],
  model: PaperSignalModel,
): PaperConfidenceReliability {
  const ordered = outcomes
    .filter(
      (outcome) =>
        Number.isFinite(Date.parse(outcome.signalTime)) &&
        Number.isFinite(Date.parse(outcome.outcomeTime)),
    )
    .toSorted(
      (left, right) => Date.parse(left.signalTime) - Date.parse(right.signalTime),
    );
  const toSample = (outcome: PaperTradeOutcome) => ({
    x: feature(outcome),
    won: outcome.won,
  });
  const foldSize = Math.max(1, Math.ceil(ordered.length / FOLD_COUNT));
  const scored: Array<{ outcome: PaperTradeOutcome; model: number; baseline: number }> = [];
  let foldCount = 0;
  let embargoDroppedCount = 0;

  for (let start = foldSize; start < ordered.length; start += foldSize) {
    const fold = ordered.slice(start, start + foldSize);
    const foldStartMs = Date.parse(fold[0].signalTime);
    const history = ordered.slice(0, start);
    const train = history.filter(
      (outcome) => Date.parse(outcome.outcomeTime) <= foldStartMs,
    );
    if (train.length < MINIMUM_TRAIN_SAMPLES) continue;
    foldCount += 1;
    embargoDroppedCount += history.length - train.length;
    const fit = fitPlattScaling(train.map(toSample));
    const baseRate = train.filter((outcome) => outcome.won).length / train.length;
    for (const outcome of fold) {
      scored.push({
        outcome,
        model: predict(fit, feature(outcome)),
        baseline: baseRate,
      });
    }
  }

  const base = {
    model,
    method: "platt-walk-forward" as const,
    minimumTrainSamples: MINIMUM_TRAIN_SAMPLES,
    minimumTestSamples: MINIMUM_TEST_SAMPLES,
    foldCount,
    testCount: scored.length,
    embargoDroppedCount,
    researchOnly: true as const,
  };

  if (scored.length < MINIMUM_TEST_SAMPLES) {
    return {
      ...base,
      status: "collecting",
      independentSampleCount: new Set(
        scored.map((item) => item.outcome.signalTime),
      ).size,
      brierScore: null,
      baselineBrierScore: null,
      brierSkillScore: null,
      improvementLow: null,
      improvementHigh: null,
      slopePer10Points: null,
      calibratedWinRates: [],
      reasons: [
        `検証できた採点が${scored.length}/${MINIMUM_TEST_SAMPLES}件です。` +
          `1区間あたり${MINIMUM_TRAIN_SAMPLES}件以上の確定済み履歴が必要です。`,
      ],
    };
  }

  const squaredError = (probability: number, won: boolean) =>
    (probability - (won ? 1 : 0)) ** 2;
  const brierScore =
    scored.reduce((total, item) => total + squaredError(item.model, item.outcome.won), 0) /
    scored.length;
  const baselineBrierScore =
    scored.reduce((total, item) => total + squaredError(item.baseline, item.outcome.won), 0) /
    scored.length;
  const improvement = clusteredMeanInterval(
    scored.map((item) => ({
      key: item.outcome.signalTime,
      value:
        squaredError(item.baseline, item.outcome.won) -
        squaredError(item.model, item.outcome.won),
    })),
  );
  const fullFit = fitPlattScaling(ordered.map(toSample));
  const significant = improvement.low !== null && improvement.low > 0;
  const status: PaperConfidenceReliability["status"] = !significant
    ? "uninformative"
    : fullFit.slope < 0
      ? "inverted"
      : "informative";

  return {
    ...base,
    status,
    independentSampleCount: improvement.independentSampleCount,
    brierScore: round(brierScore, 4),
    baselineBrierScore: round(baselineBrierScore, 4),
    brierSkillScore:
      baselineBrierScore > 0 ? round(1 - brierScore / baselineBrierScore, 3) : null,
    improvementLow: improvement.low === null ? null : round(improvement.low, 4),
    improvementHigh: improvement.high === null ? null : round(improvement.high, 4),
    slopePer10Points: round(fullFit.slope / 10, 3),
    calibratedWinRates: DISPLAY_CONFIDENCES.map((confidence) => ({
      confidence,
      winProbabilityPercent: round(predict(fullFit, confidence / 100) * 100, 1),
    })),
    reasons: [
      status === "informative"
        ? "未使用の期間でも、確信度から求めた勝率が平均勝率より有意に当たりました。"
        : status === "inverted"
          ? "未使用の期間で有意な差があり、確信度が高いほど負けやすい傾向です。"
          : "未使用の期間では、確信度を使っても平均勝率より有意に当たりませんでした。",
    ],
  };
}
