import "server-only";

import { z } from "zod";

const NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ROUTES = "https://aggregator-api.kyberswap.com/base/api/v1/routes";
const PRICE = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=jpy,usd&include_last_updated_at=true&precision=full";
const WEI = BigInt("1000000000000000000");
const MAX_UINT = (BigInt(1) << BigInt(256)) - BigInt(1);
const SLIPPAGE_BPS = 50; // Research scenario, not an approved execution setting.
const QUOTE_AGE_MS = 10_000;
const PRICE_AGE_MS = 180_000; // Display estimate only; not the execution gate's 10s.

export class BasePaperQuoteError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const unitsSchema = z.string().regex(/^[1-9][0-9]{0,77}$/)
  .refine((value) => {
    try {
      return BigInt(value) <= MAX_UINT;
    } catch {
      return false;
    }
  });
const decimalSchema = z.string().regex(/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$/);
// Display-only provider value: returned as-is, never converted. KyberSwap Base returns 21+ decimals.
const l1FeeUsdSchema = z.string().regex(/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,36})?$/);
const timestampSchema = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9][0-9]{0,12}$/).transform(Number),
]);
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
  .refine((value) => !/^0x0{40}$/.test(value));
const routeSchema = z.object({
  code: z.literal(0),
  data: z.object({
    routerAddress: addressSchema,
    routeSummary: z.object({
      tokenIn: z.string(),
      tokenOut: z.string(),
      amountIn: unitsSchema,
      amountOut: unitsSchema,
      gas: unitsSchema,
      gasPrice: unitsSchema,
      gasUsd: decimalSchema,
      l1FeeUsd: l1FeeUsdSchema.nullish(),
      timestamp: timestampSchema,
    }),
  }),
});
const priceSchema = z.object({
  ethereum: z.object({
    jpy: z.number().finite().positive(),
    usd: z.number().finite().positive(),
    last_updated_at: z.number().int().positive().safe(),
  }),
});

function parsePriceResponse(value: unknown) {
  const parsed = priceSchema.safeParse(value);
  if (!parsed.success) throw new BasePaperQuoteError("PRICE_RESPONSE_INVALID");
  return parsed.data;
}

function parseRouteResponse(value: unknown, errorCode: "BUY_ROUTE_RESPONSE_INVALID" | "SELL_ROUTE_RESPONSE_INVALID") {
  const parsed = routeSchema.safeParse(value);
  if (!parsed.success) throw new BasePaperQuoteError(errorCode);
  return parsed.data;
}

type RouteSummary = ReturnType<typeof parseRouteResponse>["data"]["routeSummary"];

// Provider-reported values, kept as validated strings. Never summed, filled in or executed.
function providerEstimate(summary: RouteSummary) {
  return {
    gas: summary.gas,
    gasPriceWei: summary.gasPrice,
    gasUsd: summary.gasUsd,
    l1FeeUsd: summary.l1FeeUsd ?? null,
  };
}

function decimal(value: string): { numerator: bigint; denominator: bigint } {
  const parsed = decimalSchema.parse(value);
  const [whole, fraction = ""] = parsed.split(".");
  return {
    numerator: BigInt(whole + fraction),
    denominator: BigInt(10) ** BigInt(fraction.length),
  };
}

function ceil(numerator: bigint, denominator: bigint): number {
  const rounded = (numerator + denominator - BigInt(1)) / denominator;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new BasePaperQuoteError("INVALID_PROVIDER_DATA");
  return Number(rounded);
}

function checkTime(timestampMs: number, now: number, maxAge: number, code: string) {
  if (!Number.isSafeInteger(timestampMs) || timestampMs > now || now - timestampMs > maxAge) {
    throw new BasePaperQuoteError(code);
  }
}

export interface BasePaperQuoteDependencies {
  fetch?: typeof fetch;
  now?: () => number;
}

/**
 * GET-only diagnostic. No wallet, calldata, approvals, signatures or broadcast.
 * A successful observation MUST NOT be converted into a paper-ready/live order.
 */
export async function getBasePaperQuote(
  requestedYen: 500 | 1000,
  dependencies: BasePaperQuoteDependencies = {},
) {
  if (requestedYen !== 500 && requestedYen !== 1000) throw new BasePaperQuoteError("INVALID_AMOUNT");
  const fetcher = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const startedAtMs = now();

  async function getJson(url: string): Promise<unknown> {
    try {
      const response = await fetcher(url, {
        method: "GET",
        headers: { Accept: "application/json", "X-Client-Id": "sumi-trade-lab" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new BasePaperQuoteError(
        response.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_UNAVAILABLE",
      );
      return await response.json();
    } catch (error) {
      if (error instanceof BasePaperQuoteError) throw error;
      // Do not expose response bodies, URLs, headers or raw network errors.
      throw new BasePaperQuoteError("PROVIDER_UNAVAILABLE");
    }
  }

  try {
    const price = parsePriceResponse(await getJson(PRICE)).ethereum;
    const valuationAtMs = price.last_updated_at * 1_000;
    checkTime(valuationAtMs, now(), PRICE_AGE_MS, "PRICE_STALE");
    const yen = decimal(String(price.jpy));
    const usd = decimal(String(price.usd));
    const amountIn = BigInt(requestedYen) * yen.denominator * WEI / yen.numerator;
    unitsSchema.parse(amountIn.toString());

    async function route(
      tokenIn: string,
      tokenOut: string,
      amount: bigint,
      responseError: "BUY_ROUTE_RESPONSE_INVALID" | "SELL_ROUTE_RESPONSE_INVALID",
    ) {
      const query = new URLSearchParams({
        tokenIn, tokenOut, amountIn: amount.toString(), gasInclude: "true",
        excludeRFQSources: "true",
      });
      const response = parseRouteResponse(await getJson(`${ROUTES}?${query}`), responseError).data;
      const data = response.routeSummary;
      if (data.tokenIn.toLowerCase() !== tokenIn.toLowerCase() ||
          data.tokenOut.toLowerCase() !== tokenOut.toLowerCase() ||
          data.amountIn !== amount.toString()) throw new BasePaperQuoteError("QUOTE_MISMATCH");
      const quotedAtMs = data.timestamp * 1_000;
      checkTime(quotedAtMs, now(), QUOTE_AGE_MS, "QUOTE_STALE");
      const minimumOut = BigInt(data.amountOut) * BigInt(10_000 - SLIPPAGE_BPS) / BigInt(10_000);
      if (minimumOut === BigInt(0)) throw new BasePaperQuoteError("AMOUNT_TOO_LOW");
      return { data, routerAddress: response.routerAddress.toLowerCase(), quotedAtMs, minimumOut };
    }

    const buy = await route(NATIVE_ETH, BASE_USDC, amountIn, "BUY_ROUTE_RESPONSE_INVALID");
    // Quote the sale of the conservative buy output, never the optimistic output.
    const sell = await route(BASE_USDC, NATIVE_ETH, buy.minimumOut, "SELL_ROUTE_RESPONSE_INVALID");
    // Both legs must name the same router. It is reported only; never approved, signed or sent to.
    if (buy.routerAddress !== sell.routerAddress) throw new BasePaperQuoteError("QUOTE_MISMATCH");
    const observedAtMs = now();
    checkTime(buy.quotedAtMs, observedAtMs, QUOTE_AGE_MS, "QUOTE_STALE");
    checkTime(sell.quotedAtMs, observedAtMs, QUOTE_AGE_MS, "QUOTE_STALE");
    checkTime(valuationAtMs, observedAtMs, PRICE_AGE_MS, "PRICE_STALE");
    checkTime(startedAtMs, observedAtMs, 25_000, "OBSERVATION_EXPIRED");

    function gasYen(value: string): number {
      const gas = decimal(value);
      return ceil(gas.numerator * yen.numerator * usd.denominator,
        gas.denominator * yen.denominator * usd.numerator);
    }
    const buyGasYen = gasYen(buy.data.gasUsd);
    const sellGasYen = gasYen(sell.data.gasUsd);
    const lossWei = amountIn > sell.minimumOut ? amountIn - sell.minimumOut : BigInt(0);
    const swapShortfallYen = ceil(lossWei * yen.numerator, WEI * yen.denominator);
    const knownCostEstimateYen = BigInt(swapShortfallYen) + BigInt(buyGasYen) + BigInt(sellGasYen);
    if (knownCostEstimateYen > BigInt(Number.MAX_SAFE_INTEGER)) throw new BasePaperQuoteError("INVALID_PROVIDER_DATA");

    return {
      mode: "paper" as const,
      executionLocked: true as const,
      profitabilityVerified: false as const,
      status: "observed" as const,
      readiness: "blocked" as const,
      chainId: 8453,
      pair: "ETH/USDC/ETH",
      requestedYen,
      amountInWei: amountIn.toString(),
      buyAmountOutUsdcUnits: buy.data.amountOut,
      buyMinimumOutUsdcUnits: buy.minimumOut.toString(),
      sellMinimumOutWei: sell.minimumOut.toString(),
      assumedSlippageBpsPerLeg: SLIPPAGE_BPS,
      valuation: { provider: "coingecko", ethJpy: price.jpy, ethUsd: price.usd, valuationAtMs, maxAgeMs: PRICE_AGE_MS },
      observedAtMs,
      quoteExpiresAtMs: Math.min(buy.quotedAtMs, sell.quotedAtMs) + QUOTE_AGE_MS,
      provider: "kyberswap",
      routerAddress: buy.routerAddress,
      providerEstimate: { buy: providerEstimate(buy.data), sell: providerEstimate(sell.data) },
      providerSwapGasEstimateYen: { buy: buyGasYen, sell: sellGasYen },
      swapShortfallEstimateYen: swapShortfallYen,
      knownCostEstimateYen: Number(knownCostEstimateYen),
      totalCostYen: null,
      reserveSufficient: null,
      incompleteChecks: [
        "L1_FEE_COVERAGE_UNVERIFIED", "TOKEN_APPROVAL_COST_UNVERIFIED",
        "SIGNER_FEES_UNVERIFIED", "WALLET_BALANCE_UNVERIFIED",
        "EXECUTION_VALUATION_UNVERIFIED",
      ],
    };
  } catch (error) {
    if (error instanceof BasePaperQuoteError) throw error;
    throw new BasePaperQuoteError("INVALID_PROVIDER_DATA");
  }
}
