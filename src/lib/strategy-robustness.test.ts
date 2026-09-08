import { describe, expect, it } from "vitest";

import {
  analyzeStrategyRobustness,
  type RobustnessTrade,
} from "@/lib/strategy-robustness";

function trade(netPnlUsd: number, cost = 2): RobustnessTrade {
  return {
    netPnlUsd,
    equityBeforeTrade: 1_000,
    gasCostUsd: cost / 2,
    slippageCostUsd: cost / 2,
  };
}

describe("strategy robustness", () => {
  it("waits for at least five trades", () => {
    const result = analyzeStrategyRobustness([trade(10), trade(-5)]);
    expect(result.status).toBe("insufficient");
    expect(result.simulationCount).toBe(0);
  });

  it("is deterministic and passes a durable profitable sample", () => {
    const trades = [12, 9, 15, -3, 11, 8, 14, -2].map((value) => trade(value));
    const first = analyzeStrategyRobustness(trades);
    const second = analyzeStrategyRobustness(trades);

    expect(first).toEqual(second);
    expect(first.status).toBe("pass");
    expect(first.simulationCount).toBe(1_000);
    expect(first.profitablePathRate).toBeGreaterThanOrEqual(60);
    expect(first.costSensitivity.at(-1)?.netReturnPercent).toBeGreaterThan(0);
  });

  it("reviews a strategy that loses its edge when costs double", () => {
    const trades = [3, 3, 3, 3, 3, 3].map((value) => trade(value, 4));
    const result = analyzeStrategyRobustness(trades);

    expect(result.status).toBe("review");
    expect(result.costSensitivity.at(-1)?.netReturnPercent).toBeLessThanOrEqual(0);
    expect(result.reasons).toContain("コスト2倍で期待収益が消失");
  });

  it("reports ruin risk for repeatedly destructive returns", () => {
    const trades = [-220, -180, -250, -210, -200, -230].map((value) => trade(value));
    const result = analyzeStrategyRobustness(trades);

    expect(result.status).toBe("review");
    expect(result.riskOfRuinPercent).toBeGreaterThan(1);
  });
});
