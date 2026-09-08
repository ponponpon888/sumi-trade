import { describe, expect, it } from "vitest";

import { calculateRegimePerformance } from "@/lib/paper-journal-core";
import type { MarketRegime, PaperTradeOutcome } from "@/lib/types";

function outcome(
  marketRegime: MarketRegime | undefined,
  netReturnPercent: number,
  index: number,
): PaperTradeOutcome {
  const signalTime = new Date(Date.UTC(2026, 8, 1, index)).toISOString();
  return {
    decisionId: `regime-${index}`,
    model: "chart",
    priceKey: "TEST",
    symbol: "TEST",
    direction: "BUY",
    entryPriceUsd: 100,
    modelScore: 75,
    confidence: 80,
    marketRegime,
    notionalUsd: 100,
    estimatedCostUsd: 0,
    costGatePassed: true,
    signalTime,
    outcomeTime: signalTime,
    exitPriceUsd: 100 + netReturnPercent,
    grossReturnPercent: netReturnPercent,
    netReturnPercent,
    netPnlUsd: netReturnPercent,
    won: netReturnPercent > 0,
  };
}

describe("regime performance", () => {
  it("groups chart outcomes by the regime captured at signal time", () => {
    const outcomes = [
      ...Array.from({ length: 10 }, (_, index) => outcome("uptrend", 1, index)),
      outcome("range", -2, 10),
      outcome("range", 1, 11),
      outcome(undefined, 50, 12),
    ];
    const result = calculateRegimePerformance(outcomes);

    expect(result).toHaveLength(5);
    expect(result.find((item) => item.regime === "uptrend")).toMatchObject({
      maturedCount: 10,
      status: "monitoring",
      alert: false,
      winRate: 100,
      netPnlUsd: 10,
    });
    expect(result.find((item) => item.regime === "range")).toMatchObject({
      maturedCount: 2,
      status: "collecting",
      alert: false,
      netPnlUsd: -1,
    });
    expect(result.reduce((sum, item) => sum + item.maturedCount, 0)).toBe(12);
  });

  it("raises a research-only alert after ten materially weak outcomes", () => {
    const outcomes = Array.from(
      { length: 10 },
      (_, index) => outcome("downtrend", -1.25, index),
    );
    const performance = calculateRegimePerformance(outcomes).find(
      (item) => item.regime === "downtrend",
    );

    expect(performance).toMatchObject({
      maturedCount: 10,
      status: "alert",
      alert: true,
      averageNetReturnPercent: -1.25,
      profitFactor: 0,
      researchOnly: true,
    });
  });

  it("does not alert on losses before the minimum sample size", () => {
    const outcomes = Array.from(
      { length: 9 },
      (_, index) => outcome("high-volatility", -5, index),
    );
    const performance = calculateRegimePerformance(outcomes).find(
      (item) => item.regime === "high-volatility",
    );

    expect(performance).toMatchObject({
      maturedCount: 9,
      status: "collecting",
      alert: false,
    });
  });
});
