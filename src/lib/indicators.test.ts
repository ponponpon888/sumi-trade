import { describe, expect, it } from "vitest";

import {
  aggregateCandles,
  exponentialMovingAverage,
  normalizeCandles,
  relativeStrengthIndex,
} from "@/lib/indicators";
import type { OhlcvCandle } from "@/lib/types";

function candle(timestamp: number, close: number): OhlcvCandle {
  return {
    timestamp,
    open: close,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume: 100,
  };
}

describe("technical indicators", () => {
  it("normalizes newest-first data and removes an open candle", () => {
    const start = 1_700_000_000 - (1_700_000_000 % 300);
    const values = [
      candle(start + 600, 3),
      candle(start, 1),
      candle(start + 300, 2),
    ];
    const result = normalizeCandles(values, 300, start + 900);
    expect(result.map((item) => item.close)).toEqual([1, 2, 3]);
    expect(normalizeCandles(values, 300, start + 600)).toHaveLength(2);
  });

  it("aggregates twelve five-minute candles into one hour", () => {
    const start = 1_700_000_000 - (1_700_000_000 % 3_600);
    const values = Array.from({ length: 12 }, (_, index) =>
      candle(start + index * 300, 100 + index),
    );
    const result = aggregateCandles(values, "1h");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ open: 100, close: 111, volume: 1_200 });
  });

  it("calculates stable EMA and bounded RSI", () => {
    expect(exponentialMovingAverage(Array(30).fill(10), 9)).toBe(10);
    expect(relativeStrengthIndex(Array.from({ length: 20 }, (_, index) => index), 14)).toBe(100);
    expect(relativeStrengthIndex(Array.from({ length: 20 }, (_, index) => 20 - index), 14)).toBe(0);
  });
});

