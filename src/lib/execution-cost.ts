import {
  ESTIMATED_SLIPPAGE_PERCENT,
  ESTIMATED_SWAP_GAS_USD,
  MAX_PRICE_IMPACT_PERCENT,
} from "@/lib/config";
import type { ExecutionCostEstimate } from "@/lib/types";

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Conservative constant-product AMM approximation. DEX liquidity is normally
 * reported as the combined USD value of both pool sides, so only half is
 * treated as immediately available depth for one direction.
 */
export function estimateExecutionCost(
  positionUsd: number,
  liquidityUsd: number | null,
): ExecutionCostEstimate {
  const safePositionUsd = Math.max(0, positionUsd);
  const hasLiquidity = liquidityUsd !== null && Number.isFinite(liquidityUsd);
  const safeLiquidityUsd = hasLiquidity ? Math.max(0, liquidityUsd) : null;
  const oneSideReserveUsd = safeLiquidityUsd === null ? null : safeLiquidityUsd / 2;
  const rawPriceImpactPercent =
    safePositionUsd === 0
      ? 0
      : oneSideReserveUsd === null
        ? 0
        : oneSideReserveUsd === 0
          ? 100
          : (safePositionUsd / (oneSideReserveUsd + safePositionUsd)) * 100;
  const rawOneWaySlippagePercent =
    ESTIMATED_SLIPPAGE_PERCENT + rawPriceImpactPercent;
  const rawGasUsd = ESTIMATED_SWAP_GAS_USD * 2;
  const rawSlippageUsd =
    safePositionUsd * (rawOneWaySlippagePercent / 100) * 2;
  const rawRoundTripCostUsd = rawGasUsd + rawSlippageUsd;
  const positionToLiquidityPercent =
    safeLiquidityUsd && safeLiquidityUsd > 0
      ? (safePositionUsd / safeLiquidityUsd) * 100
      : safeLiquidityUsd === null
        ? null
        : 100;

  return {
    mode: safeLiquidityUsd === null ? "base-estimate" : "liquidity-aware",
    liquidityUsd: safeLiquidityUsd,
    positionToLiquidityPercent:
      positionToLiquidityPercent === null
        ? null
        : round(positionToLiquidityPercent, 4),
    estimatedPriceImpactPercent: round(rawPriceImpactPercent, 4),
    estimatedOneWaySlippagePercent: round(rawOneWaySlippagePercent, 4),
    estimatedGasUsd: round(rawGasUsd),
    estimatedSlippageUsd: round(rawSlippageUsd),
    estimatedRoundTripCostUsd: round(rawRoundTripCostUsd),
    priceImpactGatePassed:
      safeLiquidityUsd === null ||
      rawPriceImpactPercent <= MAX_PRICE_IMPACT_PERCENT,
  };
}
