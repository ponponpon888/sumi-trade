import { describe, expect, it } from "vitest";

import { classifyRegime } from "@/lib/regime";
import type { Timeframe, TimeframeIndicators, TrendDirection } from "@/lib/types";

function timeframe(
  name: Timeframe,
  trend: TrendDirection,
  overrides: Partial<TimeframeIndicators> = {},
): TimeframeIndicators {
  return {
    timeframe: name,
    candleCount: 100,
    close: 100,
    emaFast: trend === "bullish" ? 102 : trend === "bearish" ? 98 : 100,
    emaSlow: 100,
    rsi14: 50,
    atrPercent: 1.5,
    volumeRatio: 1,
    trend,
    ...overrides,
  };
}

const aligned = (trend: TrendDirection) => [
  timeframe("5m", trend),
  timeframe("15m", trend),
  timeframe("1h", trend),
];

describe("market regime classifier", () => {
  it("selects trend following when upper timeframes rise together", () => {
    const result = classifyRegime(aligned("bullish"));
    expect(result).toMatchObject({
      regime: "uptrend",
      strategy: "trend-following",
      riskMultiplier: 1,
    });
  });

  it("prioritizes capital preservation in an aligned downtrend", () => {
    const result = classifyRegime(aligned("bearish"));
    expect(result).toMatchObject({
      regime: "downtrend",
      strategy: "capital-preservation",
      riskMultiplier: 0.5,
    });
  });

  it("moves to risk-off before considering trend when ATR is extreme", () => {
    const frames = aligned("bullish");
    frames[1] = timeframe("15m", "bullish", { atrPercent: 5.2 });
    expect(classifyRegime(frames)).toMatchObject({
      regime: "high-volatility",
      strategy: "risk-off",
      riskMultiplier: 0.25,
    });
  });

  it("blocks markets below the stricter regime liquidity gate", () => {
    expect(
      classifyRegime(aligned("bullish"), {
        liquidityUsd: 200_000,
        volume24hUsd: 20_000,
      }),
    ).toMatchObject({
      regime: "low-liquidity",
      strategy: "blocked",
      riskMultiplier: 0,
    });
  });

  it("uses reduced mean reversion risk when upper timeframes disagree", () => {
    const result = classifyRegime([
      timeframe("5m", "bullish"),
      timeframe("15m", "neutral"),
      timeframe("1h", "bearish"),
    ]);
    expect(result).toMatchObject({
      regime: "range",
      strategy: "mean-reversion",
      riskMultiplier: 0.5,
    });
  });
});
