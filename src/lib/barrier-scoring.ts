import type { PaperBarrierExit } from "@/lib/types";

export interface BarrierPlan {
  direction: "BUY" | "SELL";
  entryPriceUsd: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  /** Null disables the trailing stop. */
  trailingStopPercent: number | null;
  /**
   * The trailing stop only arms once the best price has moved this far in the
   * trade's favor. 0 (the default) arms it at entry, as the backtest does.
   */
  trailingActivationPercent?: number;
}

export interface BarrierPricePoint {
  timeMs: number;
  priceUsd: number;
}

export interface BarrierExitResult {
  exit: PaperBarrierExit;
  exitTimeMs: number;
  exitPriceUsd: number;
  /** Favorable move in percent: price change for BUY, its negative for SELL. */
  grossReturnPercent: number;
}

/**
 * Replays the chart backtest's exit rules on the five-minute scan prices that
 * follow a paper signal: a hard stop, a trailing stop from the best price so
 * far, and a take-profit, closed at the horizon if none is touched.
 *
 * Scan prices are samples, not candles, so the path between two scans is
 * unknown. A stop therefore fills at the observed price (never better than
 * the stop level) and a take-profit fills at its level (never better than the
 * target), which keeps the result conservative like the backtest.
 */
export function simulateBarrierExit(
  plan: BarrierPlan,
  path: BarrierPricePoint[],
  horizon: BarrierPricePoint,
): BarrierExitResult {
  const sign = plan.direction === "BUY" ? 1 : -1;
  const entry = plan.entryPriceUsd;
  // Distances measured in the favorable direction, so SELL mirrors BUY.
  const hardStop = entry * (1 - (sign * plan.stopLossPercent) / 100);
  const takeProfit = entry * (1 + (sign * plan.takeProfitPercent) / 100);
  const favorable = (price: number) => sign * ((price - entry) / entry) * 100;
  const activation = plan.trailingActivationPercent ?? 0;
  let best = entry;

  for (const point of path) {
    if (point.timeMs >= horizon.timeMs) break;
    best = sign > 0 ? Math.max(best, point.priceUsd) : Math.min(best, point.priceUsd);
    const trailingArmed =
      plan.trailingStopPercent !== null && favorable(best) >= activation;
    const trailingStop = trailingArmed
      ? best * (1 - (sign * plan.trailingStopPercent!) / 100)
      : hardStop;
    const stop = sign > 0
      ? Math.max(hardStop, trailingStop)
      : Math.min(hardStop, trailingStop);
    if (sign * (point.priceUsd - stop) <= 0) {
      const exitPrice = sign > 0
        ? Math.min(point.priceUsd, stop)
        : Math.max(point.priceUsd, stop);
      return {
        exit: stop === hardStop ? "stop-loss" : "trailing-stop",
        exitTimeMs: point.timeMs,
        exitPriceUsd: exitPrice,
        grossReturnPercent: favorable(exitPrice),
      };
    }
    if (sign * (point.priceUsd - takeProfit) >= 0) {
      return {
        exit: "take-profit",
        exitTimeMs: point.timeMs,
        exitPriceUsd: takeProfit,
        grossReturnPercent: favorable(takeProfit),
      };
    }
  }

  return {
    exit: "horizon",
    exitTimeMs: horizon.timeMs,
    exitPriceUsd: horizon.priceUsd,
    grossReturnPercent: favorable(horizon.priceUsd),
  };
}
