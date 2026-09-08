import { describe, expect, it } from "vitest";

import { estimateExecutionCost } from "@/lib/execution-cost";

describe("execution cost engine", () => {
  it("estimates less price impact in a deeper pool", () => {
    const shallow = estimateExecutionCost(2_000, 500_000);
    const deep = estimateExecutionCost(2_000, 5_000_000);

    expect(shallow.mode).toBe("liquidity-aware");
    expect(shallow.estimatedPriceImpactPercent).toBeGreaterThan(
      deep.estimatedPriceImpactPercent,
    );
    expect(shallow.estimatedRoundTripCostUsd).toBeGreaterThan(
      deep.estimatedRoundTripCostUsd,
    );
  });

  it("blocks an order whose price impact exceeds the hard limit", () => {
    const estimate = estimateExecutionCost(10_000, 500_000);

    expect(estimate.estimatedPriceImpactPercent).toBeGreaterThan(1.5);
    expect(estimate.priceImpactGatePassed).toBe(false);
  });

  it("falls back to the configured base estimate without liquidity data", () => {
    const estimate = estimateExecutionCost(1_000, null);

    expect(estimate.mode).toBe("base-estimate");
    expect(estimate.estimatedPriceImpactPercent).toBe(0);
    expect(estimate.estimatedOneWaySlippagePercent).toBe(0.35);
    expect(estimate.priceImpactGatePassed).toBe(true);
  });

  it("handles zero-sized blocked positions without artificial impact", () => {
    const estimate = estimateExecutionCost(0, 0);

    expect(estimate.estimatedPriceImpactPercent).toBe(0);
    expect(estimate.estimatedSlippageUsd).toBe(0);
  });
});
