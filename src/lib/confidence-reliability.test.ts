import { describe, expect, it } from "vitest";

import {
  calculateConfidenceReliability,
  fitPlattScaling,
} from "@/lib/confidence-reliability";
import type { PaperTradeOutcome } from "@/lib/types";

const HOUR_MS = 3_600_000;

function outcome(
  index: number,
  confidence: number,
  won: boolean,
  overrides: Partial<PaperTradeOutcome> = {},
): PaperTradeOutcome {
  const signalMs = Date.UTC(2026, 8, 1) + index * HOUR_MS;
  return {
    decisionId: `reliability-${index}`,
    model: "chart",
    priceKey: "TEST",
    symbol: "TEST",
    direction: "BUY",
    entryPriceUsd: 100,
    modelScore: 70,
    confidence,
    notionalUsd: 100,
    estimatedCostUsd: 1,
    costGatePassed: true,
    signalTime: new Date(signalMs).toISOString(),
    outcomeTime: new Date(signalMs + 6 * HOUR_MS).toISOString(),
    exitPriceUsd: won ? 102 : 98,
    grossReturnPercent: won ? 2 : -2,
    netReturnPercent: won ? 1 : -3,
    netPnlUsd: won ? 1 : -3,
    won,
    ...overrides,
  };
}

describe("fitPlattScaling", () => {
  it("fits a rising win probability when high confidence wins", () => {
    const fit = fitPlattScaling([
      ...Array.from({ length: 20 }, () => ({ x: 0.4, won: false })),
      ...Array.from({ length: 20 }, () => ({ x: 0.9, won: true })),
    ]);
    expect(fit.slope).toBeGreaterThan(0);
  });

  it("stays finite when every sample has the same result", () => {
    const fit = fitPlattScaling(
      Array.from({ length: 30 }, (_, index) => ({ x: index / 30, won: true })),
    );
    expect(Number.isFinite(fit.intercept)).toBe(true);
    expect(Number.isFinite(fit.slope)).toBe(true);
  });
});

describe("calculateConfidenceReliability", () => {
  it("collects until a fold has twenty settled training outcomes", () => {
    const result = calculateConfidenceReliability(
      Array.from({ length: 20 }, (_, index) => outcome(index, 60, index % 2 === 0)),
      "chart",
    );
    expect(result).toMatchObject({
      status: "collecting",
      testCount: 0,
      calibratedWinRates: [],
      researchOnly: true,
    });
  });

  it("marks confidence informative when it separates winners out of sample", () => {
    const outcomes = Array.from({ length: 120 }, (_, index) => {
      const high = index % 2 === 0;
      return outcome(index, high ? 90 : 40, high);
    });
    const result = calculateConfidenceReliability(outcomes, "chart");
    expect(result.status).toBe("informative");
    expect(result.improvementLow!).toBeGreaterThan(0);
    expect(result.brierSkillScore!).toBeGreaterThan(0);
    expect(result.calibratedWinRates.at(-1)!.winProbabilityPercent)
      .toBeGreaterThan(result.calibratedWinRates[0].winProbabilityPercent);
  });

  it("marks confidence inverted when high confidence loses out of sample", () => {
    const outcomes = Array.from({ length: 120 }, (_, index) => {
      const high = index % 2 === 0;
      return outcome(index, high ? 90 : 40, !high);
    });
    const result = calculateConfidenceReliability(outcomes, "chart");
    expect(result.status).toBe("inverted");
    expect(result.slopePer10Points!).toBeLessThan(0);
  });

  it("does not credit confidence that is unrelated to the result", () => {
    // Every confidence level wins exactly half of the time.
    const outcomes = Array.from({ length: 120 }, (_, index) =>
      outcome(index, [40, 90][index % 2], Math.floor(index / 2) % 2 === 0));
    expect(calculateConfidenceReliability(outcomes, "chart").status)
      .toBe("uninformative");
  });

  it("only trains on outcomes that settled before the fold began", () => {
    const outcomes = Array.from({ length: 100 }, (_, index) =>
      outcome(index, 60, index % 2 === 0));
    const result = calculateConfidenceReliability(outcomes, "chart");
    // Signals are one hour apart with a six-hour horizon, so the five newest
    // history outcomes are still open at the start of each scored fold.
    expect(result.embargoDroppedCount).toBe(result.foldCount * 5);
  });

  it("counts outcomes from one scan as a single sample", () => {
    const outcomes = Array.from({ length: 120 }, (_, index) =>
      outcome(Math.floor(index / 3) * 3, index % 2 ? 90 : 40, index % 2 === 1, {
        decisionId: `scan-${index}`,
      }));
    const result = calculateConfidenceReliability(outcomes, "chart");
    expect(result.independentSampleCount).toBeLessThan(result.testCount);
    expect(result.independentSampleCount * 3).toBe(result.testCount);
  });
});
