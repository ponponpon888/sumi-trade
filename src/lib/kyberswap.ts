import "server-only";

import { z } from "zod";

import {
  KYBERSWAP_ORIGIN,
  MAX_PREFLIGHT_ROUND_TRIP_LOSS_PERCENT,
  PREFLIGHT_QUOTE_USD,
} from "@/lib/config";
import {
  classifyDataSourceFailure,
  DataSourceHttpError,
} from "@/lib/data-source-failure";
import {
  assessQuotePreflight,
  type RawPreflightRoute,
  unavailableQuotePreflight,
} from "@/lib/quote-preflight-core";
import type { PreflightAssessment } from "@/lib/types";

const NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/**
 * KyberSwapはUSD建ての値を文字列でも数値でも返すことがあるため、どちらも受け取る。
 * 片方だけを許すスキーマにすると、相手側の型変更だけで取得元全体が
 * parse-errorとなり、数日単位で新規BUYが停止する。
 */
const numberLike = z.union([z.string(), z.number()]);

const routeSchema = z.object({
  code: z.number(),
  data: z.object({
    routeSummary: z.object({
      // wei建ての整数は精度のため文字列のみを受け付ける
      amountIn: z.string(),
      amountInUsd: numberLike,
      amountOut: z.string(),
      amountOutUsd: numberLike,
      gasUsd: numberLike,
      // 実APIはUNIX秒の「数値」を返す（以前のz.string()では必ずZodErrorになっていた）
      timestamp: numberLike,
      route: z.array(
        z.array(
          z.object({
            exchange: z.string(),
          }),
        ),
      ),
    }),
  }),
});

function finite(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** UNIX秒（数値・数値文字列）はISO文字列へ、ISO文字列などはそのまま返す。 */
function quotedAtIso(timestamp: string | number): string {
  const seconds = typeof timestamp === "number" ? timestamp : Number(timestamp);
  if (Number.isFinite(seconds) && seconds > 0) {
    return new Date(seconds * 1_000).toISOString();
  }
  if (typeof timestamp === "string" && timestamp.trim() !== "") return timestamp;
  return new Date().toISOString();
}

async function getRoute(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
): Promise<RawPreflightRoute | null> {
  const query = new URLSearchParams({
    tokenIn,
    tokenOut,
    amountIn,
    gasInclude: "true",
  });
  const response = await fetch(
    `${KYBERSWAP_ORIGIN}/ethereum/api/v1/routes?${query}`,
    {
      headers: {
        Accept: "application/json",
        "X-Client-Id": "sumi-trade-lab",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    },
  );
  if ([400, 404, 422].includes(response.status)) return null;
  if (!response.ok) {
    throw new DataSourceHttpError(
      response.status,
      `KyberSwap route request failed (${response.status}).`,
    );
  }

  const parsed = routeSchema.parse(await response.json());
  if (parsed.code !== 0) return null;
  const summary = parsed.data.routeSummary;
  return {
    amountIn: summary.amountIn,
    amountOut: summary.amountOut,
    amountInUsd: finite(summary.amountInUsd),
    amountOutUsd: finite(summary.amountOutUsd),
    gasUsd: finite(summary.gasUsd),
    exchanges: summary.route.flat().map((step) => step.exchange),
    quotedAt: quotedAtIso(summary.timestamp),
  };
}

function ethWeiForUsd(amountUsd: number, ethPriceUsd: number): string {
  const gwei = Math.floor((amountUsd / ethPriceUsd) * 1_000_000_000);
  return (BigInt(Math.max(1, gwei)) * BigInt(1_000_000_000)).toString();
}

async function getTokenPreflight(
  tokenAddress: string,
  ethPriceUsd: number,
): Promise<PreflightAssessment> {
  if (!Number.isFinite(ethPriceUsd) || ethPriceUsd <= 0) {
    return unavailableQuotePreflight(
      PREFLIGHT_QUOTE_USD,
      "ETH価格を取得できないため双方向見積を停止",
    );
  }

  try {
    const buy = await getRoute(
      NATIVE_ETH,
      tokenAddress,
      ethWeiForUsd(PREFLIGHT_QUOTE_USD, ethPriceUsd),
    );
    if (!buy) {
      return assessQuotePreflight(
        PREFLIGHT_QUOTE_USD,
        null,
        null,
        MAX_PREFLIGHT_ROUND_TRIP_LOSS_PERCENT,
      );
    }
    const sell = await getRoute(tokenAddress, NATIVE_ETH, buy.amountOut);
    return assessQuotePreflight(
      PREFLIGHT_QUOTE_USD,
      buy,
      sell,
      MAX_PREFLIGHT_ROUND_TRIP_LOSS_PERCENT,
    );
  } catch (error) {
    return {
      ...unavailableQuotePreflight(PREFLIGHT_QUOTE_USD),
      failureKind: classifyDataSourceFailure(error),
    };
  }
}

export async function getQuotePreflightAssessments(
  tokenAddresses: string[],
  ethPriceUsd: number,
): Promise<Map<string, PreflightAssessment>> {
  const unique = [...new Set(tokenAddresses.map((address) => address.toLowerCase()))];
  const results = await Promise.all(
    unique.map(
      async (address) =>
        [address, await getTokenPreflight(address, ethPriceUsd)] as const,
    ),
  );
  return new Map(results);
}
