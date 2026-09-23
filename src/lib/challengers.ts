import { clusteredDifferenceInterval } from "@/lib/statistics";
import type {
  PaperChallengerComparison,
  PaperChallengerId,
  PaperChallengerResult,
  PaperTradeOutcome,
} from "@/lib/types";

const MINIMUM_SAMPLES_PER_GROUP = 10 as const;
const MINIMUM_INDEPENDENT_SAMPLES_PER_GROUP = 5 as const;

interface ChallengerDefinition {
  id: PaperChallengerId;
  description: string;
  /**
   * Fixed when the challenger was added. Never move it earlier: scoring
   * signals recorded before the rule existed would let hindsight pick it.
   */
  registeredAt: string;
  /** Signals that carry the data the rule reads; only these are scored. */
  eligible: (outcome: PaperTradeOutcome) => boolean;
  keeps: (outcome: PaperTradeOutcome) => boolean;
}

/** Share of 1h DEX flow on the signal's side: buys for BUY, sells for SELL. */
function flowSupport(outcome: PaperTradeOutcome): number | null {
  const share = outcome.orderFlow?.buyShareH1;
  if (share === null || share === undefined) return null;
  return outcome.direction === "BUY" ? share : 1 - share;
}

/**
 * The registry. Add new challengers with a new id and the current time as
 * registeredAt; do not edit the rule of an existing id, register a new one.
 */
export const CHALLENGERS: readonly ChallengerDefinition[] = [
  {
    id: "flow-aligned-only",
    description: "直近1時間のDEX取引の55%以上がシグナルと同じ向きの場合だけ取る",
    registeredAt: "2026-09-23T00:00:00.000Z",
    eligible: (outcome) => flowSupport(outcome) !== null,
    keeps: (outcome) => flowSupport(outcome)! >= 0.55,
  },
  {
    id: "skip-flow-opposed",
    description: "直近1時間のDEX取引の55%以上がシグナルと逆向きの場合だけ見送る",
    registeredAt: "2026-09-23T00:00:00.000Z",
    eligible: (outcome) => flowSupport(outcome) !== null,
    keeps: (outcome) => flowSupport(outcome)! > 0.45,
  },
  {
    id: "confidence-70-plus",
    description: "確信度70以上のシグナルだけ取る",
    registeredAt: "2026-09-23T00:00:00.000Z",
    eligible: (outcome) => Number.isFinite(outcome.confidence),
    keeps: (outcome) => outcome.confidence >= 70,
  },
];

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(outcomes: PaperTradeOutcome[]): number | null {
  return outcomes.length
    ? round(
      outcomes.reduce((total, outcome) => total + outcome.netReturnPercent, 0) /
        outcomes.length,
    )
    : null;
}

/**
 * A filter has skill only if the signals it keeps beat the ones it skips.
 * Judging the skipped signals against zero is not enough: when every signal
 * loses after costs, skipping any of them at random would look like an
 * improvement. The interval is Bonferroni-widened across all challengers.
 */
export function calculateChallengerComparison(
  outcomes: PaperTradeOutcome[],
  challengers: readonly ChallengerDefinition[] = CHALLENGERS,
): PaperChallengerComparison {
  const familyConfidence = 1 - 0.05 / Math.max(1, challengers.length);
  const chart = outcomes.filter((outcome) => (outcome.model ?? "chart") === "chart");

  const results: PaperChallengerResult[] = challengers.map((challenger) => {
    const registeredMs = Date.parse(challenger.registeredAt);
    const baseline = chart.filter(
      (outcome) =>
        Date.parse(outcome.signalTime) >= registeredMs && challenger.eligible(outcome),
    );
    const kept = baseline.filter(challenger.keeps);
    const excluded = baseline.filter((outcome) => !challenger.keeps(outcome));
    const toSample = (outcome: PaperTradeOutcome) => ({
      key: outcome.signalTime,
      value: outcome.netReturnPercent,
    });
    const interval = clusteredDifferenceInterval(
      kept.map(toSample),
      excluded.map(toSample),
      familyConfidence,
    );
    const samplePassed =
      kept.length >= MINIMUM_SAMPLES_PER_GROUP &&
      excluded.length >= MINIMUM_SAMPLES_PER_GROUP &&
      interval.leftSampleCount >= MINIMUM_INDEPENDENT_SAMPLES_PER_GROUP &&
      interval.rightSampleCount >= MINIMUM_INDEPENDENT_SAMPLES_PER_GROUP;
    const status: PaperChallengerResult["status"] = !samplePassed
      ? "collecting"
      : interval.low !== null && interval.low > 0
        ? "challenger-better"
        : interval.high !== null && interval.high < 0
          ? "challenger-worse"
          : "no-difference";

    return {
      id: challenger.id,
      description: challenger.description,
      registeredAt: challenger.registeredAt,
      baselineCount: baseline.length,
      keptCount: kept.length,
      excludedCount: excluded.length,
      excludedIndependentSampleCount: interval.rightSampleCount,
      keptIndependentSampleCount: interval.leftSampleCount,
      baselineAverageNetReturnPercent: average(baseline),
      keptAverageNetReturnPercent: average(kept),
      excludedAverageNetReturnPercent: average(excluded),
      netPnlDifferenceUsd: round(
        -excluded.reduce((total, outcome) => total + outcome.netPnlUsd, 0),
      ),
      differenceLowPercent: interval.low === null ? null : round(interval.low),
      differenceHighPercent: interval.high === null ? null : round(interval.high),
      status,
    };
  });

  return {
    familyConfidence: round(familyConfidence, 4),
    minimumSamplesPerGroup: MINIMUM_SAMPLES_PER_GROUP,
    minimumIndependentSamplesPerGroup: MINIMUM_INDEPENDENT_SAMPLES_PER_GROUP,
    challengers: results,
    researchOnly: true,
  };
}
