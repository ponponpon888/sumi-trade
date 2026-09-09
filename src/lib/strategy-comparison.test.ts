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
    expect(result.walkForwardByRegime).toEqual([]);
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
    expect(
      result.walkForwardByRegime.reduce(
        (total, regime) => total + regime.windowCount,
        0,
      ),
    ).toBe(3);
    expect(
      result.walkForwardByRegime.every(
        (regime) =>
          regime.researchOnly &&
          regime.results.length === 3 &&
          regime.leaderId === regime.results[0]?.id &&
          regime.results.every(
            (strategy) => strategy.windowCount === regime.windowCount,
          ),
      ),
    ).toBe(true);
  });

  it("attributes each test window using only its starting history", () => {
    const candles = comparisonSeries(480);
    const futureShock = candles.map((candle, index) =>
      index < 360
        ? candle
        : {
            ...candle,
            open: candle.open * (1 + (index - 359) * 0.01),
            high: candle.high * (1 + (index - 359) * 0.01),
            low: candle.low * (1 + (index - 359) * 0.01),
            close: candle.close * (1 + (index - 359) * 0.01),
          },
    );
    const result = compareStrategies(candles);
    const shockedResult = compareStrategies(futureShock);

    expect(result.walkForwardByRegime).toHaveLength(1);
    expect(result.walkForwardByRegime[0]).toMatchObject({
      windowCount: 1,
      researchOnly: true,
    });
    expect(shockedResult.walkForwardByRegime[0]?.regime).toBe(
      result.walkForwardByRegime[0]?.regime,
    );
    expect(result.notes).toContain(
      "各10時間テスト窓を開始時点までの情報で局面分類",
    );
  });

  it("is deterministic for identical candles", () => {
    const candles = comparisonSeries(480);

    expect(compareStrategies(candles)).toEqual(compareStrategies(candles));
  });
});
