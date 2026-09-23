import { z } from "zod";

// Explicit export fields: Zod objects strip unknown keys at every object level.
const source = z.enum([
  "blockscout", "dexscreener", "geckoterminal", "ethereum-rpc", "kyberswap",
]);

const buyGate = z.enum([
  "passed", "not-tradable", "contract-safety", "quote-preflight",
  "onchain-preflight", "robustness", "cost-gate", "model-drift",
  "portfolio-risk", "budget", "not-in-plan",
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
  buyGate: buyGate.optional(),
  buyGateFailures: z.array(buyGate).optional(),
  orderFlow: z.object({
    buyShareH1: z.number().nullable(),
    buyShareH6: z.number().nullable(),
    volumeAccelerationH1: z.number().nullable(),
  }).optional(),
  stopLossPercent: z.number().optional(),
  takeProfitPercent: z.number().optional(),
  trailingStopPercent: z.number().optional(),
  barrier: z.object({
    exit: z.enum(["take-profit", "stop-loss", "trailing-stop", "horizon"]),
    exitTime: z.string(),
    exitPriceUsd: z.number(),
    grossReturnPercent: z.number(),
    netReturnPercent: z.number(),
    netPnlUsd: z.number(),
    won: z.boolean(),
    pricePointCount: z.number(),
  }).optional(),
  horizonNetReturnsPercent: z.object({
    h1: z.number().nullable(),
    h2: z.number().nullable(),
    h4: z.number().nullable(),
    h6: z.number(),
  }).optional(),
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
