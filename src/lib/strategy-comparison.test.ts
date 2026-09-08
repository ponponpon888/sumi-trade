import { describe, expect, it } from "vitest";

import { compareStrategies, runBacktest } from "@/lib/chart-model";
import type { OhlcvCandle } from "@/lib/types";

function comparisonSeries(length = 720): OhlcvCandle[] {
  const start = 1_700_000_000 - (1_700_000_000 % 3_600);
  return Array.from({ length }, (_, index) => {
    const baseline = 100 + index * 0.018;
    const wave = Math.sin(index * 0.31) * 1.8;
    const close = baseline + wave;
    const previousWave = Math.sin((index - 1) * 0.31) * 1.8;
    const open = baseline + previousWave;
    return {
      timestamp: start + index * 300,
      open,
      high: Math.max(open, close) + 0.32,
      low: Math.min(open, close) - 0.32,
      close,
      volume: 100 + (index % 11) * 4,
    };
  });
}

describe("strategy comparison", () => {
  it("fails closed until the minimum closed history exists", () => {
    const result = compareStrategies(comparisonSeries(259));

    expect(result.status).toBe("insufficient");
    expect(result.candleCount).toBe(259);
    expect(result.leaderId).toBeNull();
    expect(result.results).toEqual([]);
    expect(result.researchOnly).toBe(true);
  });

  it("ranks all strategies under one conservative execution model", () => {
    const candles = comparisonSeries();
    const sumiBacktest = runBacktest(candles);
    const result = compareStrategies(candles, sumiBacktest);

    expect(result.status).toBe("ready");
    expect(result.researchOnly).toBe(true);
    expect(result.benchmarkReturnPercent).toBe(
      sumiBacktest.benchmarkReturnPercent,
    );
    expect(result.results.map((item) => item.id).sort()).toEqual([
      "ema-trend",
      "rsi-reversion",
      "sumi-regime",
    ]);
    expect(result.results.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(
      result.results.every(
        (item) => item.executionModel === "next-open-conservative",
      ),
    ).toBe(true);
    expect(result.leaderId).toBe(result.results[0]?.id);
  });

  it("is deterministic for identical candles", () => {
    const candles = comparisonSeries(480);

    expect(compareStrategies(candles)).toEqual(compareStrategies(candles));
  });
});
