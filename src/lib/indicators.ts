import type {
  OhlcvCandle,
  Timeframe,
  TimeframeIndicators,
  TrendDirection,
} from "@/lib/types";

const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "5m": 5 * 60,
  "15m": 15 * 60,
  "1h": 60 * 60,
};

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function normalizeCandles(
  candles: OhlcvCandle[],
  intervalSeconds = TIMEFRAME_SECONDS["5m"],
  nowSeconds = Math.floor(Date.now() / 1_000),
): OhlcvCandle[] {
  const byTimestamp = new Map<number, OhlcvCandle>();

  for (const candle of candles) {
    const valid =
      Number.isInteger(candle.timestamp) &&
      candle.timestamp > 0 &&
      candle.timestamp + intervalSeconds <= nowSeconds &&
      isFinitePositive(candle.open) &&
      isFinitePositive(candle.high) &&
      isFinitePositive(candle.low) &&
      isFinitePositive(candle.close) &&
      Number.isFinite(candle.volume) &&
      candle.volume >= 0 &&
      candle.high >= Math.max(candle.open, candle.close) &&
      candle.low <= Math.min(candle.open, candle.close);

    if (valid) {
      byTimestamp.set(candle.timestamp, candle);
    }
  }

  return [...byTimestamp.values()].toSorted(
    (left, right) => left.timestamp - right.timestamp,
  );
}

export function aggregateCandles(
  candles: OhlcvCandle[],
  timeframe: Timeframe,
): OhlcvCandle[] {
  if (timeframe === "5m") {
    return candles;
  }

  const targetSeconds = TIMEFRAME_SECONDS[timeframe];
  const expectedCandles = targetSeconds / TIMEFRAME_SECONDS["5m"];
  const buckets = new Map<number, OhlcvCandle[]>();

  for (const candle of candles) {
    const bucket = Math.floor(candle.timestamp / targetSeconds) * targetSeconds;
    const group = buckets.get(bucket);
    if (group) {
      group.push(candle);
    } else {
      buckets.set(bucket, [candle]);
    }
  }

  const aggregated: OhlcvCandle[] = [];
  for (const [timestamp, group] of buckets) {
    const ordered = group.toSorted((left, right) => left.timestamp - right.timestamp);
    if (ordered.length < expectedCandles) {
      continue;
    }

    const first = ordered[0];
    const last = ordered.at(-1);
    if (!first || !last) {
      continue;
    }

    aggregated.push({
      timestamp,
      open: first.open,
      high: Math.max(...ordered.map((candle) => candle.high)),
      low: Math.min(...ordered.map((candle) => candle.low)),
      close: last.close,
      volume: ordered.reduce((total, candle) => total + candle.volume, 0),
    });
  }

  return aggregated.toSorted((left, right) => left.timestamp - right.timestamp);
}

export function exponentialMovingAverage(
  values: number[],
  period: number,
): number | null {
  if (period <= 0 || values.length < period) {
    return null;
  }

  let ema = values
    .slice(0, period)
    .reduce((total, value) => total + value, 0) / period;
  const multiplier = 2 / (period + 1);

  for (let index = period; index < values.length; index += 1) {
    ema = (values[index] - ema) * multiplier + ema;
  }

  return Number.isFinite(ema) ? ema : null;
}

export function relativeStrengthIndex(
  values: number[],
  period = 14,
): number | null {
  if (period <= 0 || values.length <= period) {
    return null;
  }

  let gains = 0;
  let losses = 0;
  const start = values.length - period;
  for (let index = start; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    if (change >= 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  const averageGain = gains / period;
  const averageLoss = losses / period;
  if (averageGain === 0 && averageLoss === 0) {
    return 50;
  }
  if (averageLoss === 0) {
    return 100;
  }

  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

export function averageTrueRange(
  candles: OhlcvCandle[],
  period = 14,
): number | null {
  if (period <= 0 || candles.length <= period) {
    return null;
  }

  const recent = candles.slice(-(period + 1));
  let total = 0;
  for (let index = 1; index < recent.length; index += 1) {
    const candle = recent[index];
    const previousClose = recent[index - 1].close;
    total += Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  }

  return total / period;
}

export function currentVolumeRatio(
  candles: OhlcvCandle[],
  lookback = 20,
): number | null {
  if (lookback <= 0 || candles.length <= lookback) {
    return null;
  }

  const current = candles.at(-1)?.volume ?? 0;
  const baseline = candles.slice(-(lookback + 1), -1);
  const average = baseline.reduce((total, candle) => total + candle.volume, 0) / lookback;
  if (average <= 0) {
    return null;
  }

  return current / average;
}

function detectTrend(
  close: number,
  emaFast: number,
  emaSlow: number,
): TrendDirection {
  if (emaFast > emaSlow && close > emaFast) {
    return "bullish";
  }
  if (emaFast < emaSlow && close < emaFast) {
    return "bearish";
  }
  return "neutral";
}

export function evaluateTimeframe(
  candles: OhlcvCandle[],
  timeframe: Timeframe,
): TimeframeIndicators {
  const grouped = aggregateCandles(candles, timeframe);
  const closes = grouped.map((candle) => candle.close);
  const close = closes.at(-1) ?? null;
  const emaFast = exponentialMovingAverage(closes, 9);
  const emaSlow = exponentialMovingAverage(closes, 21);
  const rsi14 = relativeStrengthIndex(closes, 14);
  const atr = averageTrueRange(grouped, 14);
  const atrPercent =
    atr !== null && close !== null && close > 0 ? (atr / close) * 100 : null;
  const volumeRatio = currentVolumeRatio(grouped, 20);

  return {
    timeframe,
    candleCount: grouped.length,
    close,
    emaFast,
    emaSlow,
    rsi14,
    atrPercent,
    volumeRatio,
    trend:
      close !== null && emaFast !== null && emaSlow !== null
        ? detectTrend(close, emaFast, emaSlow)
        : "neutral",
  };
}

