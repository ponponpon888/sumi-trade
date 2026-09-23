import { z } from "zod";

import { DEXSCREENER_ORIGIN } from "@/lib/config";
import {
  classifyDataSourceFailure,
  DataSourceHttpError,
} from "@/lib/data-source-failure";
import { asFiniteNumber } from "@/lib/number";
import type { DataSourceFailureKind, MarketData } from "@/lib/types";

export type MarketLookup =
  | { status: "found"; market: MarketData }
  | { status: "no-pair" }
  | { status: "failed"; failureKind: DataSourceFailureKind };

const tokenSchema = z.object({
  address: z.string(),
  name: z.string(),
  symbol: z.string(),
});

const transactionCountSchema = z.object({
  buys: z.number().nullable().optional(),
  sells: z.number().nullable().optional(),
}).optional();

const pairSchema = z.object({
  chainId: z.string(),
  dexId: z.string(),
  url: z.string(),
  pairAddress: z.string(),
  baseToken: tokenSchema,
  quoteToken: tokenSchema,
  priceUsd: z.string().nullable().optional(),
  liquidity: z.object({ usd: z.number().nullable().optional() }).optional(),
  volume: z.object({
    h1: z.number().nullable().optional(),
    h24: z.number().nullable().optional(),
  }).optional(),
  txns: z.object({
    h1: transactionCountSchema,
    h6: transactionCountSchema,
  }).partial().optional(),
  priceChange: z.object({ h24: z.number().nullable().optional() }).optional(),
});

const responseSchema = z.object({
  pairs: z.array(pairSchema).nullable().optional(),
});

const TRUSTED_QUOTES = new Set(
  [
    "0x0000000000000000000000000000000000000000",
    "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  ].map((address) => address.toLowerCase()),
);

export async function getTokenMarket(
  contractAddress: string,
): Promise<MarketData | null> {
  const response = await fetch(
    `${DEXSCREENER_ORIGIN}/latest/dex/tokens/${encodeURIComponent(contractAddress)}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "SUMI-Trade-Lab/0.1 read-only",
      },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(12_000),
    },
  );

  if (!response.ok) {
    throw new DataSourceHttpError(
      response.status,
      `Market data request failed (${response.status}).`,
    );
  }

  const parsed = responseSchema.parse(await response.json());
  const normalizedAddress = contractAddress.toLowerCase();
  const candidates = (parsed.pairs ?? [])
    .filter(
      (pair) =>
        pair.chainId === "ethereum" &&
        pair.baseToken.address.toLowerCase() === normalizedAddress &&
        TRUSTED_QUOTES.has(pair.quoteToken.address.toLowerCase()),
    )
    .sort(
      (left, right) =>
        (right.liquidity?.usd ?? 0) - (left.liquidity?.usd ?? 0),
    );

  const pair = candidates[0];
  if (!pair) {
    return null;
  }

  return {
    dexId: pair.dexId,
    pairAddress: pair.pairAddress,
    pairUrl: pair.url,
    priceUsd: asFiniteNumber(pair.priceUsd),
    liquidityUsd: pair.liquidity?.usd ?? 0,
    volume24hUsd: pair.volume?.h24 ?? 0,
    priceChange24h: pair.priceChange?.h24 ?? null,
    orderFlow: {
      buysH1: pair.txns?.h1?.buys ?? null,
      sellsH1: pair.txns?.h1?.sells ?? null,
      buysH6: pair.txns?.h6?.buys ?? null,
      sellsH6: pair.txns?.h6?.sells ?? null,
      volumeH1Usd: pair.volume?.h1 ?? null,
    },
  };
}

/** Distinguishes a failed request from a successful response without a trusted pair. */
export async function getTokenMarketLookups(
  contractAddresses: string[],
): Promise<Map<string, MarketLookup>> {
  const settled = await Promise.allSettled(
    contractAddresses.map((address) => getTokenMarket(address)),
  );

  const lookups = new Map<string, MarketLookup>();
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    const address = contractAddresses[index].toLowerCase();
    lookups.set(
      address,
      result.status === "rejected"
        ? { status: "failed", failureKind: classifyDataSourceFailure(result.reason) }
        : result.value
          ? { status: "found", market: result.value }
          : { status: "no-pair" },
    );
  }

  return lookups;
}

export async function getTokenMarkets(
  contractAddresses: string[],
): Promise<Map<string, MarketData | null>> {
  const lookups = await getTokenMarketLookups(contractAddresses);
  return new Map(
    [...lookups].map(([address, lookup]) => [
      address,
      lookup.status === "found" ? lookup.market : null,
    ]),
  );
}
