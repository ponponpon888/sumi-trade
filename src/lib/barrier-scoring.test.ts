import { describe, expect, it } from "vitest";

import { simulateBarrierExit, type BarrierPlan } from "@/lib/barrier-scoring";

const MINUTE_MS = 60_000;
const BUY: BarrierPlan = {
  direction: "BUY",
  entryPriceUsd: 100,
  stopLossPercent: 4,
  takeProfitPercent: 8,
  trailingStopPercent: 3,
};
const SELL: BarrierPlan = { ...BUY, direction: "SELL" };
const HORIZON = { timeMs: 360 * MINUTE_MS, priceUsd: 101 };

function path(...prices: number[]) {
  return prices.map((priceUsd, index) => ({
    timeMs: (index + 1) * 5 * MINUTE_MS,
    priceUsd,
  }));
}

describe("simulateBarrierExit", () => {
  it("fills a take-profit at its level, not at a higher scan price", () => {
    expect(simulateBarrierExit(BUY, path(102, 110), HORIZON)).toMatchObject({
      exit: "take-profit",
      exitTimeMs: 10 * MINUTE_MS,
      exitPriceUsd: 108,
      grossReturnPercent: 8,
    });
  });

  it("fills a stop at the observed price when the scan gapped through it", () => {
    // The trailing stop starts at 97 (3% under entry), above the 96 hard stop, so it triggers.
    expect(simulateBarrierExit(BUY, path(99, 95), HORIZON)).toMatchObject({
      exit: "trailing-stop",
      exitPriceUsd: 95,
      grossReturnPercent: -5,
    });
  });

  it("uses the hard stop once it is above the trailing stop", () => {
    const wideTrail = { ...BUY, trailingStopPercent: 6 };
    expect(simulateBarrierExit(wideTrail, path(99, 96), HORIZON)).toMatchObject({
      exit: "stop-loss",
      exitPriceUsd: 96,
    });
  });

  it("raises the trailing stop with the best price", () => {
    // Best 106 -> trailing stop 102.82; 102 falls through it.
    const result = simulateBarrierExit(BUY, path(103, 106, 104, 102), HORIZON);
    expect(result.exit).toBe("trailing-stop");
    expect(result.exitPriceUsd).toBe(102);
    expect(result.grossReturnPercent).toBeCloseTo(2);
  });

  it("closes at the horizon when no level is touched", () => {
    expect(simulateBarrierExit(BUY, path(100.5, 101.5), HORIZON)).toMatchObject({
      exit: "horizon",
      exitTimeMs: HORIZON.timeMs,
      grossReturnPercent: 1,
    });
  });

  it("mirrors the levels for a SELL signal", () => {
    expect(simulateBarrierExit(SELL, path(98, 91), HORIZON)).toMatchObject({
      exit: "take-profit",
      exitPriceUsd: 92,
      grossReturnPercent: 8,
    });
    expect(simulateBarrierExit(SELL, path(101, 104), HORIZON)).toMatchObject({
      exit: "trailing-stop",
      exitPriceUsd: 104,
      grossReturnPercent: -4,
    });
  });

  it("ignores prices at or after the horizon", () => {
    const late = [{ timeMs: HORIZON.timeMs, priceUsd: 150 }];
    expect(simulateBarrierExit(BUY, late, HORIZON).exit).toBe("horizon");
  });
});
