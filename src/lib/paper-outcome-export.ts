import { z } from "zod";

// Explicit export fields: Zod objects strip unknown keys at every object level.
const source = z.enum([
  "blockscout", "dexscreener", "geckoterminal", "ethereum-rpc", "kyberswap",
]);

const outcome = z.object({
  decisionId: z.string().optional(),
  model: z.enum(["chart", "community-trend"]).optional(),
  priceKey: z.string().optional(),
  contractAddress: z.string().optional(),
  symbol: z.string(),
  direction: z.enum(["BUY", "SELL"]),
  entryPriceUsd: z.number(),
  modelScore: z.number(),
  confidence: z.number(),
  marketRegime: z.enum([
    "uptrend", "downtrend", "range", "high-volatility", "low-liquidity",
  ]).optional(),
  decisionReasons: z.array(z.string()).optional(),
  notionalUsd: z.number(),
  estimatedCostUsd: z.number(),
  costGatePassed: z.boolean(),
  signalTime: z.string(),
  outcomeTime: z.string(),
  exitPriceUsd: z.number(),
  grossReturnPercent: z.number(),
  netReturnPercent: z.number(),
  netPnlUsd: z.number(),
  won: z.boolean(),
  entryDataQuality: z.object({
    status: z.enum(["complete", "partial", "unavailable"]),
    averageCoveragePercent: z.number(),
    degradedSources: z.array(source),
    unavailableSources: z.array(source),
  }).optional(),
});

export function sanitizePaperExportOutcomes(input: unknown) {
  return z.array(outcome).parse(input);
}
