import "server-only";

import { z } from "zod";

import { CHART_CANDLE_LIMIT, GECKOTERMINAL_ORIGIN } from "@/lib/config";
import { DataSourceHttpError } from "@/lib/data-source-failure";
import type { OhlcvCandle } from "@/lib/types";

const ohlcvRowSchema = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);

const ohlcvResponseSchema = z.object({
  data: z.object({
    attributes: z.object({
      ohlcv_list: z.array(ohlcvRowSchema),
    }),
  }),
});

export function parseOhlcvResponse(payload: unknown): OhlcvCandle[] {
  const parsed = ohlcvResponseSchema.parse(payload);
  return parsed.data.attributes.ohlcv_list.map(
    ([timestamp, open, high, low, close, volume]) => ({
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    }),
  );
}

export async function getPoolOhlcv(pairAddress: string): Promise<OhlcvCandle[]> {
  const encodedAddress = encodeURIComponent(pairAddress);
  const query = new URLSearchParams({
    aggregate: "5",
    limit: String(CHART_CANDLE_LIMIT),
    currency: "usd",
    token: "base",
    include_empty_intervals: "true",
  });
  const response = await fetch(
    `${GECKOTERMINAL_ORIGIN}/networks/eth/pools/${encodedAddress}/ohlcv/minute?${query}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "SUMI-Trade-Lab/0.2 paper-model",
      },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(12_000),
    },
  );

  if (!response.ok) {
    throw new DataSourceHttpError(
      response.status,
      `OHLCV request failed (${response.status}).`,
    );
  }

  return parseOhlcvResponse(await response.json());
}

