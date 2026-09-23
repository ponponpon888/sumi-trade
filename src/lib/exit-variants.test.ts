import { describe, expect, it } from "vitest";

import { calculateExitVariantComparison, EXIT_VARIANTS } from "@/lib/exit-variants";
import type { PaperExitVariantId, PaperTradeOutcome } from "@/lib/types";

const REGISTERED_MS = Date.parse("2026-09-23T06:00:00.000Z");
const HOUR_MS = 60 * 60 * 1_000;

function outcome(
  hoursAfterRegistration: number,
  currentNet: number,
  variantNet: Partial<Record<PaperExitVariantId, number>>,
  pricePointCount = 70,
): PaperTradeOutcome {
  const signalMs = REGISTERED_MS + hoursAfterRegistration * HOUR_MS;
  return {
    decisionId: `exit-${hoursAfterRegistration}`,
    model: "chart",
    symbol: "TEST",
    direction: "BUY",
    entryPriceUsd: 100,
    modelScore: 75,
    confidence: 50,
    notionalUsd: 100,
    estimatedCostUsd: 1,
    costGatePassed: true,
    signalTime: new Date(signalMs).toISOString(),
    outcomeTime: new Date(signalMs + 6 * HOUR_MS).toISOString(),
    exitPriceUsd: 100,
    grossReturnPercent: 0,
    netReturnPercent: -1,
    netPnlUsd: -1,
    won: false,
    barrier: {
      exit: "trailing-stop",
      exitTime: new Date(signalMs + HOUR_MS).toISOString(),
      exitPriceUsd: 99,
      grossReturnPercent: currentNet + 1,
      netReturnPercent: currentNet,
      netPnlUsd: currentNet,
      won: currentNet > 0,
      pricePointCount,
    },
    exitVariants: Object.fromEntries(
      Object.entries(variantNet).map(([id, net]) => [id, { exit: "horizon", netReturnPercent: net }]),
    ),
  };
}

function variant(outcomes: PaperTradeOutcome[], id: PaperExitVariantId) {
  return calculateExitVariantComparison(outcomes).variants.find((item) => item.id === id)!;
}

describe("exit variant registry", () => {
  it("has unique ids, valid registration times and a Bonferroni family", () => {
    expect(new Set(EXIT_VARIANTS.map((item) => item.id)).size).toBe(EXIT_VARIANTS.length);
    for (const item of EXIT_VARIANTS) expect(Number.isFinite(Date.parse(item.registeredAt))).toBe(true);
    expect(calculateExitVariantComparison([]).familyConfidence)
      .toBeCloseTo(1 - 0.05 / EXIT_VARIANTS.length, 4);
  });

  it("adjusts only the intended part of the exit plan", () => {
    const plan = { direction: "BUY" as const, entryPriceUsd: 100, stopLossPercent: 4, takeProfitPercent: 8, trailingStopPercent: 3 };
    const byId = Object.fromEntries(EXIT_VARIANTS.map((item) => [item.id, item.adjust(plan)]));
    expect(byId["hard-stop-only"]).toEqual({ ...plan, trailingStopPercent: null });
    expect(byId["trail-after-gain"]).toEqual({ ...plan, trailingActivationPercent: 3 });
    expect(byId["trail-at-stop-width"]).toEqual({ ...plan, trailingStopPercent: 4 });
  });
});

describe("calculateExitVariantComparison", () => {
  it("reports a variant better when it beats the current exit on every signal", () => {
    const outcomes = Array.from({ length: 20 }, (_, index) =>
      outcome(index, -1, { "hard-stop-only": 0.5 + (index % 3) * 0.1 }));
    expect(variant(outcomes, "hard-stop-only")).toMatchObject({
      status: "variant-better",
      pairedCount: 20,
      currentAverageNetReturnPercent: -1,
      exitMix: { horizon: 20, "take-profit": 0, "stop-loss": 0, "trailing-stop": 0 },
    });
  });

  it("reports a variant worse when it loses to the current exit", () => {
    const outcomes = Array.from({ length: 20 }, (_, index) =>
      outcome(index, 1, { "trail-at-stop-width": -1 - (index % 3) * 0.1 }));
    expect(variant(outcomes, "trail-at-stop-width").status).toBe("variant-worse");
  });

  it("skips signals before registration and sparse price paths", () => {
    const outcomes = [
      ...Array.from({ length: 20 }, (_, index) => outcome(-50 + index, -1, { "trail-after-gain": 1 })),
      ...Array.from({ length: 20 }, (_, index) => outcome(index, -1, { "trail-after-gain": 1 }, 10)),
    ];
    expect(variant(outcomes, "trail-after-gain")).toMatchObject({ pairedCount: 0, status: "collecting" });
  });
});
