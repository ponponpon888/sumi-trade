import { z } from "zod";

import { asFiniteNumber } from "@/lib/number";

const numberish = z.union([z.string(), z.number()]).nullable().optional();

const transactionSchema = z.object({
  buys: z.number().optional(),
  sells: z.number().optional(),
  buyers: z.number().optional(),
  sellers: z.number().optional(),
});

const relationshipSchema = z.object({
  data: z.object({ id: z.string(), type: z.string() }),
});

const poolSchema = z.object({
  id: z.string(),
  type: z.literal("pool"),
  attributes: z.object({
    base_token_price_usd: numberish,
    address: z.string(),
    name: z.string(),
    pool_created_at: z.string(),
    price_change_percentage: z.object({
      h1: numberish,
      h6: numberish,
      h24: numberish,
    }),
    transactions: z.object({ h24: transactionSchema }),
    volume_usd: z.object({ h24: numberish }),
    reserve_in_usd: numberish,
    sentiment_vote_positive_percentage: z.number().nullable().optional(),
    sentiment_vote_negative_percentage: z.number().nullable().optional(),
    community_sus_report: z.number().nullable().optional(),
  }),
  relationships: z.object({
    base_token: relationshipSchema,
    quote_token: relationshipSchema,
  }),
});

const includedTokenSchema = z.object({
  id: z.string(),
  type: z.literal("token"),
  attributes: z.object({
    address: z.string(),
    name: z.string(),
    symbol: z.string(),
  }),
});

const responseSchema = z.object({
  data: z.array(poolSchema),
  included: z.array(z.unknown()).optional(),
});

export interface EthereumTrendingPool {
  rank: number;
  contractAddress: string;
  quoteContractAddress: string;
  pairAddress: string;
  name: string;
  symbol: string;
  priceUsd: number | null;
  liquidityUsd: number;
  volume24hUsd: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  buyers24h: number;
  sellers24h: number;
  sentimentPositivePercentage: number | null;
  sentimentNegativePercentage: number | null;
  suspiciousReportCount: number;
  poolCreatedAt: string;
}

export function parseEthereumTrendingPools(
  payload: unknown,
): EthereumTrendingPool[] {
  const parsed = responseSchema.parse(payload);
  const tokens = new Map<string, z.infer<typeof includedTokenSchema>>();

  for (const item of parsed.included ?? []) {
    const result = includedTokenSchema.safeParse(item);
    if (result.success) tokens.set(result.data.id, result.data);
  }

  return parsed.data.flatMap((pool, index) => {
    const token = tokens.get(pool.relationships.base_token.data.id);
    if (!token) return [];
    const attributes = pool.attributes;
    const transactions = attributes.transactions.h24;

    return [{
      rank: index + 1,
      contractAddress: token.attributes.address.toLowerCase(),
      quoteContractAddress: pool.relationships.quote_token.data.id
        .replace(/^eth_/, "")
        .toLowerCase(),
      pairAddress: attributes.address.toLowerCase(),
      name: token.attributes.name,
      symbol: token.attributes.symbol.toUpperCase(),
      priceUsd: asFiniteNumber(attributes.base_token_price_usd),
      liquidityUsd: asFiniteNumber(attributes.reserve_in_usd) ?? 0,
      volume24hUsd: asFiniteNumber(attributes.volume_usd.h24) ?? 0,
      priceChange1h:
        asFiniteNumber(attributes.price_change_percentage.h1) ?? 0,
      priceChange6h:
        asFiniteNumber(attributes.price_change_percentage.h6) ?? 0,
      priceChange24h:
        asFiniteNumber(attributes.price_change_percentage.h24) ?? 0,
      buyers24h: transactions.buyers ?? transactions.buys ?? 0,
      sellers24h: transactions.sellers ?? transactions.sells ?? 0,
      sentimentPositivePercentage:
        attributes.sentiment_vote_positive_percentage ?? null,
      sentimentNegativePercentage:
        attributes.sentiment_vote_negative_percentage ?? null,
      suspiciousReportCount: attributes.community_sus_report ?? 0,
      poolCreatedAt: attributes.pool_created_at,
    }];
  });
}
