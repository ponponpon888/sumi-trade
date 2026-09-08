import type {
  ChartMarketContext,
  RegimeAssessment,
  TimeframeIndicators,
} from "@/lib/types";

const REGIME_MIN_LIQUIDITY_USD = 500_000;
const REGIME_MIN_VOLUME_24H_USD = 50_000;
const HIGH_VOLATILITY_ATR_PERCENT = 4.5;

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function confidenceFromAlignment(
  primary: TimeframeIndicators | undefined,
  secondary: TimeframeIndicators | undefined,
): number {
  if (!primary || !secondary) return 0;
  const atrPenalty = Math.min(25, (secondary.atrPercent ?? 0) * 3);
  const volumeSupport = Math.min(15, Math.max(0, (secondary.volumeRatio ?? 1) - 1) * 20);
  return round(Math.min(100, Math.max(0, 72 - atrPenalty + volumeSupport)));
}

export function classifyRegime(
  timeframes: TimeframeIndicators[],
  market: ChartMarketContext = { liquidityUsd: null, volume24hUsd: null },
): RegimeAssessment {
  const byTimeframe = new Map(timeframes.map((item) => [item.timeframe, item]));
  const fiveMinute = byTimeframe.get("5m");
  const fifteenMinute = byTimeframe.get("15m");
  const oneHour = byTimeframe.get("1h");

  if (
    (market.liquidityUsd !== null &&
      market.liquidityUsd < REGIME_MIN_LIQUIDITY_USD) ||
    (market.volume24hUsd !== null &&
      market.volume24hUsd < REGIME_MIN_VOLUME_24H_USD)
  ) {
    return {
      regime: "low-liquidity",
      strategy: "blocked",
      confidence: 100,
      riskMultiplier: 0,
      reasons: [
        `流動性 ${market.liquidityUsd === null ? "不明" : `$${Math.round(market.liquidityUsd).toLocaleString("en-US")}`}`,
        `24H出来高 ${market.volume24hUsd === null ? "不明" : `$${Math.round(market.volume24hUsd).toLocaleString("en-US")}`}`,
      ],
    };
  }

  const highestAtr = Math.max(
    fiveMinute?.atrPercent ?? 0,
    fifteenMinute?.atrPercent ?? 0,
    oneHour?.atrPercent ?? 0,
  );
  if (highestAtr >= HIGH_VOLATILITY_ATR_PERCENT) {
    return {
      regime: "high-volatility",
      strategy: "risk-off",
      confidence: round(Math.min(100, 55 + highestAtr * 5)),
      riskMultiplier: 0.25,
      reasons: [`最大ATR ${round(highestAtr, 2)}%`, "急変時は新規BUYを停止"],
    };
  }

  if (oneHour?.trend === "bullish" && fifteenMinute?.trend === "bullish") {
    return {
      regime: "uptrend",
      strategy: "trend-following",
      confidence: confidenceFromAlignment(oneHour, fifteenMinute),
      riskMultiplier: 1,
      reasons: ["1時間足と15分足が上昇で一致", "順張りモデルを優先"],
    };
  }

  if (oneHour?.trend === "bearish" && fifteenMinute?.trend === "bearish") {
    return {
      regime: "downtrend",
      strategy: "capital-preservation",
      confidence: confidenceFromAlignment(oneHour, fifteenMinute),
      riskMultiplier: 0.5,
      reasons: ["1時間足と15分足が下降で一致", "縮小と現金保全を優先"],
    };
  }

  return {
    regime: "range",
    strategy: "mean-reversion",
    confidence: round(
      Math.min(100, 55 + Math.max(0, 1.5 - (fifteenMinute?.atrPercent ?? 1.5)) * 10),
    ),
    riskMultiplier: 0.5,
    reasons: ["上位足の方向が不一致", "平均回帰は通常サイズの50%"],
  };
}
