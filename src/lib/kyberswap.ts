import "server-only";

import { z } from "zod";

import {
  KYBERSWAP_ORIGIN,
  MAX_PREFLIGHT_ROUND_TRIP_LOSS_PERCENT,
  PREFLIGHT_QUOTE_USD,
} from "@/lib/config";
import {
  assessQuotePreflight,
  type RawPreflightRoute,
  unavailableQuotePreflight,
} from "@/lib/quote-preflight-core";
import type { PreflightAssessment } from "@/lib/types";

const NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

const routeSchema = z.object({
  code: z.number(),
  data: z.object({
    routeSummary: z.object({
      amountIn: z.string(),
      amountInUsd: z.string(),
      amountOut: z.string(),
      amountOutUsd: z.string(),
      gasUsd: z.string(),
      timestamp: z.string(),
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

function finite(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
    throw new Error(`KyberSwap route request failed (${response.status}).`);
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
    quotedAt: summary.timestamp,
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
  } catch {
    return unavailableQuotePreflight(PREFLIGHT_QUOTE_USD);
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
