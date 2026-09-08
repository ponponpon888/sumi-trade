import { describe, expect, it } from "vitest";

import { calculateConfidenceCalibration } from "@/lib/paper-journal-core";
import type { PaperTradeOutcome } from "@/lib/types";

function outcome(
  confidence: number,
  netReturnPercent: number,
  index: number,
): PaperTradeOutcome {
  return {
    decisionId: `decision-${index}`,
    model: "chart",
    priceKey: "TEST",
    symbol: "TEST",
    direction: "BUY",
    entryPriceUsd: 100,
    modelScore: confidence,
    confidence,
    notionalUsd: 100,
    estimatedCostUsd: 0,
    costGatePassed: true,
    signalTime: `2026-09-01T${String(index).padStart(2, "0")}:00:00.000Z`,
    outcomeTime: `2026-09-01T${String(index).padStart(2, "0")}:30:00.000Z`,
    exitPriceUsd: 100 + netReturnPercent,
    grossReturnPercent: netReturnPercent,
    netReturnPercent,
    netPnlUsd: netReturnPercent,
    won: netReturnPercent > 0,
  };
}

describe("confidence calibration", () => {
  it("collects until high and lower confidence groups both have ten outcomes", () => {
    const result = calculateConfidenceCalibration(
      [outcome(80, 1, 0), outcome(60, 1, 1)],
      "chart",
    );

    expect(result.status).toBe("collecting");
    expect(result.researchOnly).toBe(true);
  });

  it("flags high-confidence inversion without changing a BUY gate", () => {
    const outcomes = [
      ...Array.from({ length: 10 }, (_, index) => outcome(80, -2, index)),
      ...Array.from({ length: 10 }, (_, index) => outcome(60, 1, index + 10)),
    ];
    const result = calculateConfidenceCalibration(outcomes, "chart");

    expect(result.status).toBe("inverted");
    expect(result.highConfidencePremiumPercentagePoints).toBe(-3);
    expect(result.reasons[0]).toContain("高確信度帯");
  });

  it("marks confidence ranking aligned when the high band performs better", () => {
    const outcomes = [
      ...Array.from({ length: 10 }, (_, index) => outcome(80, 2, index)),
      ...Array.from({ length: 10 }, (_, index) => outcome(40, 0.5, index + 10)),
    ];
    const result = calculateConfidenceCalibration(outcomes, "chart");

    expect(result.status).toBe("aligned");
    expect(result.highConfidencePremiumPercentagePoints).toBe(1.5);
    expect(result.bands.map((band) => band.maturedCount)).toEqual([10, 0, 10]);
  });
});
