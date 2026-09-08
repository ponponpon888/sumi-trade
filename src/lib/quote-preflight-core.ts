import type { PreflightAssessment, PreflightRoute } from "@/lib/types";

export interface RawPreflightRoute {
  amountIn: string;
  amountOut: string;
  amountInUsd: number;
  amountOutUsd: number;
  gasUsd: number;
  exchanges: string[];
  quotedAt: string;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeRoute(route: RawPreflightRoute): PreflightRoute {
  return {
    amountIn: route.amountIn,
    amountOut: route.amountOut,
    amountInUsd: round(route.amountInUsd),
    amountOutUsd: round(route.amountOutUsd),
    gasUsd: round(route.gasUsd),
    exchanges: [...new Set(route.exchanges)].toSorted(),
    hopCount: route.exchanges.length,
    quotedAt: route.quotedAt,
  };
}

function routeIssue(route: RawPreflightRoute, label: string): string | null {
  if (!/^\d+$/.test(route.amountIn) || !/^\d+$/.test(route.amountOut)) {
    return `${label}の数量形式が不正`;
  }
  if (
    BigInt(route.amountIn) <= 0 ||
    BigInt(route.amountOut) <= 0 ||
    !Number.isFinite(route.amountInUsd) ||
    !Number.isFinite(route.amountOutUsd) ||
    route.amountInUsd <= 0 ||
    route.amountOutUsd <= 0 ||
    !Number.isFinite(route.gasUsd) ||
    route.gasUsd < 0
  ) {
    return `${label}の見積値が不正`;
  }
  return null;
}

export function assessQuotePreflight(
  testAmountUsd: number,
  buy: RawPreflightRoute | null,
  sell: RawPreflightRoute | null,
  maxRoundTripLossPercent = 5,
): PreflightAssessment {
  const normalizedBuy = buy ? normalizeRoute(buy) : null;
  const normalizedSell = sell ? normalizeRoute(sell) : null;
  const reasons: string[] = [];
  const buyIssue = buy ? routeIssue(buy, "ETH→トークン") : null;
  const sellIssue = sell ? routeIssue(sell, "トークン→ETH") : null;

  if (!normalizedBuy) reasons.push("ETH→トークンの見積ルートなし");
  if (normalizedBuy && !normalizedSell) {
    reasons.push("トークン→ETHの売却見積ルートなし");
  }
  if (buyIssue) reasons.push(buyIssue);
  if (sellIssue) reasons.push(sellIssue);

  const roundTripRetentionPercent =
    normalizedBuy && normalizedSell && normalizedBuy.amountInUsd > 0
      ? (normalizedSell.amountOutUsd / normalizedBuy.amountInUsd) * 100
      : null;
  const roundTripLossPercent =
    roundTripRetentionPercent === null
      ? null
      : Math.max(0, 100 - roundTripRetentionPercent);

  if (
    roundTripLossPercent !== null &&
    roundTripLossPercent > maxRoundTripLossPercent
  ) {
    reasons.push(
      `往復目減り${round(roundTripLossPercent)}%が上限${maxRoundTripLossPercent}%超`,
    );
  }
  const passed = reasons.length === 0;
  if (passed) {
    reasons.push("BUY／SELL両方向のread-only見積ルートを確認");
  }

  return {
    status: passed ? "pass" : "blocked",
    provider: "kyberswap",
    testAmountUsd: round(testAmountUsd),
    buy: normalizedBuy,
    sell: normalizedSell,
    roundTripRetentionPercent:
      roundTripRetentionPercent === null
        ? null
        : round(roundTripRetentionPercent),
    roundTripLossPercent:
      roundTripLossPercent === null ? null : round(roundTripLossPercent),
    quoteTtlSeconds: 30,
    reasons,
  };
}

export function unavailableQuotePreflight(
  testAmountUsd: number,
  reason = "見積APIに接続できないため新規BUYを停止",
): PreflightAssessment {
  return {
    status: "unavailable",
    provider: "kyberswap",
    testAmountUsd: round(testAmountUsd),
    buy: null,
    sell: null,
    roundTripRetentionPercent: null,
    roundTripLossPercent: null,
    quoteTtlSeconds: 30,
    reasons: [reason],
  };
}
