import { describe, expect, it } from "vitest";

import { analyzeChart, createRiskPlan, runBacktest } from "@/lib/chart-model";
import type { OhlcvCandle } from "@/lib/types";

function marketSeries(slope: number): OhlcvCandle[] {
  const start = 1_700_000_000 - (1_700_000_000 % 3_600);
  return Array.from({ length: 720 }, (_, index) => {
    const baseline = 100 + index * slope;
    const wave = Math.sin(index * 1.35) * 0.42;
    const close = baseline + wave;
    const open = baseline + Math.sin((index - 1) * 1.35) * 0.42;
    return {
      timestamp: start + index * 300,
      open,
      high: Math.max(open, close) + 0.18,
      low: Math.min(open, close) - 0.18,
      close,
      volume: index === 719 ? 180 : 100 + (index % 7),
    };
  });
}

describe("multi-timeframe chart model", () => {
  it("marks aligned rising timeframes as a buy setup", () => {
    const candles = marketSeries(0.035);
    const now = candles.at(-1)!.timestamp + 300;
    const analysis = analyzeChart("TEST", candles, 10_000, now);
    expect(analysis.status).toBe("ready");
    expect(analysis.direction).toBe("BUY");
    expect(analysis.regime?.regime).toBe("uptrend");
    expect(analysis.score).toBeGreaterThanOrEqual(68);
    expect(analysis.correlationSeries.at(-1)).toEqual({
      timestamp: candles.at(-1)?.timestamp,
      price: candles.at(-1)?.close,
    });
  });

  it("fails closed when the latest completed candle is stale", () => {
    const candles = marketSeries(0.035);
    const now = candles.at(-1)!.timestamp + 300 + 16 * 60;
    const analysis = analyzeChart("TEST", candles, 10_000, now);

    expect(analysis.status).toBe("unavailable");
    expect(analysis.direction).toBe("HOLD");
    expect(analysis.reasons.join(" ")).toContain("上限15分");
    expect(analysis.backtest.candleCount).toBe(720);
  });

  it("marks aligned falling timeframes as a sell setup", () => {
    const candles = marketSeries(-0.035);
    const now = candles.at(-1)!.timestamp + 300;
    const analysis = analyzeChart("TEST", candles, 10_000, now);
    expect(analysis.status).toBe("ready");
    expect(analysis.direction).toBe("SELL");
    expect(analysis.regime?.regime).toBe("downtrend");
    expect(analysis.score).toBeLessThanOrEqual(32);
  });

  it("blocks small mainnet positions when round-trip costs dominate", () => {
    const risk = createRiskPlan(494, 3);
    expect(risk.costGatePassed).toBe(false);
    expect(risk.expectedGrossProfitUsd).toBeLessThan(
      risk.estimatedRoundTripCostUsd * 1.5,
    );
  });

  it("reduces position size according to the active regime", () => {
    const fullRisk = createRiskPlan(10_000, 3, 1);
    const rangeRisk = createRiskPlan(10_000, 3, 0.5);
    expect(rangeRisk.positionSizePercent).toBeLessThan(
      fullRisk.positionSizePercent,
    );
    expect(
      Math.abs(
        rangeRisk.positionSizePercent - fullRisk.positionSizePercent / 2,
      ),
    ).toBeLessThanOrEqual(0.1);
  });

  it("uses live DEX liquidity in the current execution estimate", () => {
    const candles = marketSeries(0.035);
    const now = candles.at(-1)!.timestamp + 300;
    const analysis = analyzeChart("TEST", candles, 10_000, now, {
      liquidityUsd: 2_000_000,
      volume24hUsd: 1_000_000,
    });

    expect(analysis.risk?.execution.mode).toBe("liquidity-aware");
    expect(analysis.risk?.execution.estimatedPriceImpactPercent).toBeGreaterThan(0);
    expect(analysis.risk?.execution.priceImpactGatePassed).toBe(true);
  });

  it("stops new orders when live liquidity is below the regime gate", () => {
    const candles = marketSeries(0.035);
    const now = candles.at(-1)!.timestamp + 300;
    const analysis = analyzeChart("TEST", candles, 10_000, now, {
      liquidityUsd: 200_000,
      volume24hUsd: 10_000,
    });
    expect(analysis.regime?.regime).toBe("low-liquidity");
    expect(analysis.direction).toBe("HOLD");
    expect(analysis.risk?.positionSizePercent).toBe(0);
  });

  it("returns finite historical performance statistics", () => {
    const result = runBacktest(marketSeries(0.02));
    expect(result.candleCount).toBe(720);
    expect(result.executionModel).toBe("next-open-conservative");
    expect(result.tradeCount).toBeGreaterThan(0);
    expect(Number.isFinite(result.netReturnPercent)).toBe(true);
    expect(Number.isFinite(result.benchmarkReturnPercent)).toBe(true);
    expect(result.excessReturnPercent).toBeCloseTo(
      result.netReturnPercent - result.benchmarkReturnPercent,
      1,
    );
    expect(result.maxDrawdownPercent).toBeGreaterThanOrEqual(0);
    expect(result.walkForward.windowCount).toBe(3);
    expect(result.walkForward.tradeCount).toBeGreaterThan(0);
    expect(["pass", "review", "insufficient"]).toContain(
      result.robustness.status,
    );
    expect(result.robustness.tradeCount).toBe(result.tradeCount);
  });

  it("requires enough closed history before rolling out-of-sample analysis", () => {
    const result = runBacktest(marketSeries(0.02).slice(0, 479));
    expect(result.status).not.toBe("insufficient");
    expect(result.walkForward.status).toBe("insufficient");
    expect(result.walkForward.windowCount).toBe(0);
    expect(result.robustness.status).toBe("insufficient");
  });
});
