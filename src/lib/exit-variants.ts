import type { BarrierPlan } from "@/lib/barrier-scoring";
import { clusteredMeanInterval } from "@/lib/statistics";
import type {
  PaperBarrierExit,
  PaperExitVariantComparison,
  PaperExitVariantId,
  PaperExitVariantResult,
  PaperTradeOutcome,
} from "@/lib/types";

const MINIMUM_SAMPLES = 20 as const;
const MINIMUM_INDEPENDENT_SAMPLES = 10 as const;
/** Same sparse-path cut as the exit-rule scoring comparison. */
const MINIMUM_PRICE_POINTS = 36;

interface ExitVariantDefinition {
  id: PaperExitVariantId;
  description: string;
  /**
   * Fixed when the variant was added. Only signals from this time on are
   * compared; do not move it earlier or change an existing rule.
   */
  registeredAt: string;
  /** Changes to the signal's own exit plan. */
  adjust: (plan: BarrierPlan) => BarrierPlan;
}

/**
 * The current rules arm the trailing stop at entry and it is always tighter
 * than the hard stop (ATR×1.2 vs ATR×1.8), so the hard stop never fires.
 * These variants test what that costs.
 */
export const EXIT_VARIANTS: readonly ExitVariantDefinition[] = [
  {
    id: "hard-stop-only",
    description: "トレーリングストップを使わず、固定の損切りと利確だけで閉じる",
    registeredAt: "2026-09-23T06:00:00.000Z",
    adjust: (plan) => ({ ...plan, trailingStopPercent: null }),
  },
  {
    id: "trail-after-gain",
    description: "トレーリング幅と同じだけ有利に動いてから、トレーリングストップを始める",
    registeredAt: "2026-09-23T06:00:00.000Z",
    adjust: (plan) => ({
      ...plan,
      trailingActivationPercent: plan.trailingStopPercent ?? 0,
    }),
  },
  {
    id: "trail-at-stop-width",
    description: "トレーリング幅を固定損切りと同じ幅に広げる",
    registeredAt: "2026-09-23T06:00:00.000Z",
    adjust: (plan) => ({ ...plan, trailingStopPercent: plan.stopLossPercent }),
  },
];

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function calculateExitVariantComparison(
  outcomes: PaperTradeOutcome[],
  variants: readonly ExitVariantDefinition[] = EXIT_VARIANTS,
): PaperExitVariantComparison {
  const familyConfidence = 1 - 0.05 / Math.max(1, variants.length);
  const chart = outcomes.filter(
    (outcome) =>
      (outcome.model ?? "chart") === "chart" &&
      outcome.barrier &&
      outcome.barrier.pricePointCount >= MINIMUM_PRICE_POINTS,
  );

  const results: PaperExitVariantResult[] = variants.map((variant) => {
    const registeredMs = Date.parse(variant.registeredAt);
    const paired = chart.filter(
      (outcome) =>
        Date.parse(outcome.signalTime) >= registeredMs &&
        outcome.exitVariants?.[variant.id],
    );
    const interval = clusteredMeanInterval(
      paired.map((outcome) => ({
        key: outcome.signalTime,
        value:
          outcome.exitVariants![variant.id]!.netReturnPercent -
          outcome.barrier!.netReturnPercent,
      })),
      familyConfidence,
    );
    const exitMix: Record<PaperBarrierExit, number> = {
      "take-profit": 0,
      "stop-loss": 0,
      "trailing-stop": 0,
      horizon: 0,
    };
    for (const outcome of paired) exitMix[outcome.exitVariants![variant.id]!.exit] += 1;
    const average = (values: number[]) =>
      values.length ? round(values.reduce((total, value) => total + value, 0) / values.length) : null;
    const samplePassed =
      paired.length >= MINIMUM_SAMPLES &&
      interval.independentSampleCount >= MINIMUM_INDEPENDENT_SAMPLES;

    return {
      id: variant.id,
      description: variant.description,
      registeredAt: variant.registeredAt,
      pairedCount: paired.length,
      independentSampleCount: interval.independentSampleCount,
      currentAverageNetReturnPercent: average(paired.map((outcome) => outcome.barrier!.netReturnPercent)),
      variantAverageNetReturnPercent: average(
        paired.map((outcome) => outcome.exitVariants![variant.id]!.netReturnPercent),
      ),
      differenceLowPercent: interval.low === null ? null : round(interval.low),
      differenceHighPercent: interval.high === null ? null : round(interval.high),
      exitMix,
      status: !samplePassed
        ? "collecting"
        : interval.low !== null && interval.low > 0
          ? "variant-better"
          : interval.high !== null && interval.high < 0
            ? "variant-worse"
            : "no-difference",
    };
  });

  return {
    familyConfidence: round(familyConfidence, 4),
    minimumSamples: MINIMUM_SAMPLES,
    minimumIndependentSamples: MINIMUM_INDEPENDENT_SAMPLES,
    variants: results,
    researchOnly: true,
  };
}
