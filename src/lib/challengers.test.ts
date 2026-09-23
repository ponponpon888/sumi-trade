import { describe, expect, it } from "vitest";

import { CHALLENGERS, calculateChallengerComparison } from "@/lib/challengers";
import type { PaperTradeOutcome } from "@/lib/types";

const REGISTERED_MS = Date.parse("2026-09-23T00:00:00.000Z");
const HOUR_MS = 60 * 60 * 1_000;

function outcome(
  hoursAfterRegistration: number,
  netReturnPercent: number,
  overrides: Partial<PaperTradeOutcome> = {},
): PaperTradeOutcome {
  const signalMs = REGISTERED_MS + hoursAfterRegistration * HOUR_MS;
  return {
    decisionId: `challenger-${hoursAfterRegistration}`,
    model: "chart",
    priceKey: "TEST",
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
    exitPriceUsd: 100 + netReturnPercent,
    grossReturnPercent: netReturnPercent + 1,
    netReturnPercent,
    netPnlUsd: netReturnPercent,
    won: netReturnPercent > 0,
    orderFlow: { buyShareH1: 0.5, buyShareH6: null, volumeAccelerationH1: 1 },
    ...overrides,
  };
}

function result(outcomes: PaperTradeOutcome[], id: string) {
  return calculateChallengerComparison(outcomes).challengers.find((item) => item.id === id)!;
}

describe("challenger registry", () => {
  it("has unique ids and valid registration times", () => {
    expect(new Set(CHALLENGERS.map((item) => item.id)).size).toBe(CHALLENGERS.length);
    for (const challenger of CHALLENGERS) {
      expect(Number.isFinite(Date.parse(challenger.registeredAt))).toBe(true);
    }
  });

  it("widens intervals across every registered challenger", () => {
    expect(calculateChallengerComparison([]).familyConfidence)
      .toBeCloseTo(1 - 0.05 / CHALLENGERS.length, 4);
  });
});

describe("calculateChallengerComparison", () => {
  const flow = (buyShareH1: number | null) => ({
    orderFlow: { buyShareH1, buyShareH6: null, volumeAccelerationH1: 1 },
  });

  it("ignores signals recorded before the challenger was registered", () => {
    const early = Array.from({ length: 20 }, (_, index) =>
      outcome(-100 + index, -5, { confidence: 40 }));
    expect(result(early, "confidence-70-plus")).toMatchObject({
      baselineCount: 0,
      status: "collecting",
    });
  });

  it("scores flow challengers only on signals that recorded flow", () => {
    const outcomes = [
      ...Array.from({ length: 12 }, (_, index) => outcome(index, 1, flow(null))),
      outcome(20, 1, { orderFlow: undefined }),
      outcome(21, 1, flow(0.7)),
    ];
    expect(result(outcomes, "flow-aligned-only")).toMatchObject({
      baselineCount: 1,
      keptCount: 1,
      excludedCount: 0,
    });
  });

  it("calls a challenger better when the signals it skips lose money", () => {
    const outcomes = [
      ...Array.from({ length: 12 }, (_, index) => outcome(index, 2, { confidence: 80 })),
      ...Array.from({ length: 12 }, (_, index) =>
        outcome(20 + index, -2 - (index % 3) * 0.1, { confidence: 40 })),
    ];
    expect(result(outcomes, "confidence-70-plus")).toMatchObject({
      status: "challenger-better",
      baselineCount: 24,
      keptCount: 12,
      excludedCount: 12,
      keptAverageNetReturnPercent: 2,
      netPnlDifferenceUsd: 25.2,
    });
  });

  it("calls a challenger worse when the signals it skips make money", () => {
    // A SELL with sell-heavy flow (buy share 0.3) is aligned; buy-heavy flow opposes it.
    const outcomes = [
      ...Array.from({ length: 12 }, (_, index) =>
        outcome(index, -1, { direction: "SELL", ...flow(0.3) })),
      ...Array.from({ length: 12 }, (_, index) =>
        outcome(20 + index, 3 + (index % 3) * 0.1, { direction: "SELL", ...flow(0.7) })),
    ];
    expect(result(outcomes, "skip-flow-opposed")).toMatchObject({
      status: "challenger-worse",
      keptCount: 12,
      excludedCount: 12,
    });
  });

  it("does not credit a filter just because every signal loses after costs", () => {
    // Kept and skipped signals lose the same ~1% on average: skipping them cuts
    // losses, but the filter has no skill.
    const outcomes = Array.from({ length: 40 }, (_, index) =>
      outcome(index, -1 + ((index * 7) % 5 - 2) * 0.3, { confidence: index % 2 ? 80 : 40 }));
    const challenger = result(outcomes, "confidence-70-plus");
    expect(challenger.excludedAverageNetReturnPercent!).toBeLessThan(0);
    expect(challenger.netPnlDifferenceUsd).toBeGreaterThan(0);
    expect(challenger.status).toBe("no-difference");
  });

  it("needs enough kept and skipped signals before judging", () => {
    const outcomes = [
      ...Array.from({ length: 5 }, (_, index) => outcome(index, 1, { confidence: 80 })),
      ...Array.from({ length: 20 }, (_, index) => outcome(10 + index, -2, { confidence: 40 })),
    ];
    expect(result(outcomes, "confidence-70-plus").status).toBe("collecting");
  });
});
