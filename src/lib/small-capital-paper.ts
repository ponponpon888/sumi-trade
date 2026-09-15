/**
 * Base-only, side-effect-free paper preflight. This is NOT a signing policy,
 * an order reservation, a profitability forecast, or permission to trade.
 */
export const SMALL_CAPITAL_POLICY = Object.freeze({
  chainId: 8453,
  maxFundingYen: 10_000,
  maxOrderYen: 1_000,
  quoteMaxAgeMs: 10_000,
  balanceMaxAgeMs: 5_000,
});

export interface SmallCapitalQuote {
  chainId: number;
  walletAddress: string;
  recipientAddress: string;
  inputToken: string;
  outputToken: string;
  amountInYen: number;
  /** Smallest token units, not floating-point token quantities. */
  buyMinimumOutUnits: string;
  sellAmountInUnits: string;
  /** Conservative JPY valuation of the reverse quote's minimum output. */
  sellMinimumOutYen: number;
  /** Additional fees only: never double-count fees embedded in minimum output. */
  additionalBuyFeeYen: number;
  additionalSellFeeYen: number;
  quotedAtMs: number;
  expiresAtMs: number;
  valuationAtMs: number;
}

export interface SmallCapitalPaperInput {
  nowMs: number;
  chainId: number;
  walletAddress: string;
  inputToken: string;
  outputToken: string;
  requestedYen: number;
  /** Cumulative deposits; withdrawals/profits must not reset this counter. */
  totalDepositedYen: number;
  /** Fresh spendable input-asset balance, not total mark-to-market portfolio. */
  liquidBalanceYen: number;
  /** Open-position entry cost plus pending buys; do not mark down losses here. */
  committedPrincipalYen: number;
  balanceAtMs: number;
  /** Explicit cash reserve for exits. Must cover the quoted additional sell fee. */
  exitReserveYen: number;
  /** Required paper-test policy, not a new user-approved live risk threshold. */
  maxRoundTripCostYen: number;
  emergencyStop: boolean;
  dataQuality: "healthy" | "degraded" | "unknown";
  contractSafety: "pass" | "blocked" | "unknown";
  quote: SmallCapitalQuote | null;
}

export type SmallCapitalBlockReason =
  | "INVALID_INPUT"
  | "UNSUPPORTED_CHAIN"
  | "EMERGENCY_STOP"
  | "DATA_NOT_HEALTHY"
  | "CONTRACT_NOT_VERIFIED"
  | "FUNDING_CAP_EXCEEDED"
  | "ORDER_CAP_EXCEEDED"
  | "CAPITAL_BUDGET_EXCEEDED"
  | "BALANCE_STALE"
  | "INSUFFICIENT_LIQUID_BALANCE"
  | "QUOTE_MISSING"
  | "QUOTE_INVALID"
  | "QUOTE_MISMATCH"
  | "QUOTE_STALE"
  | "QUOTE_EXPIRED"
  | "VALUATION_STALE"
  | "EXIT_RESERVE_INSUFFICIENT"
  | "ROUND_TRIP_COST_EXCEEDED";

export interface SmallCapitalPaperResult {
  mode: "paper";
  executionLocked: true;
  profitabilityVerified: false;
  status: "blocked" | "paper-ready";
  reasons: SmallCapitalBlockReason[];
  /** Never return an actionable amount on blocked input. Never auto-resize. */
  paperAmountYen: number | null;
  estimatedRoundTripCostYen: number | null;
  remainingLiquidYen: number | null;
}

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const UNITS = /^[1-9][0-9]{0,77}$/;
const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);

function whole(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function fresh(timestamp: number, nowMs: number, maxAgeMs: number): boolean {
  return whole(timestamp) && timestamp <= nowMs && nowMs - timestamp <= maxAgeMs;
}

function address(value: string): boolean {
  return typeof value === "string" && ADDRESS.test(value);
}

function units(value: string): boolean {
  return typeof value === "string" && UNITS.test(value) && BigInt(value) <= MAX_UINT256;
}

export function evaluateSmallCapitalPaper(
  input: SmallCapitalPaperInput,
): SmallCapitalPaperResult {
  const reasons: SmallCapitalBlockReason[] = [];
  const result = (
    cost: number | null = null,
    remaining: number | null = null,
  ): SmallCapitalPaperResult => ({
    mode: "paper",
    executionLocked: true,
    profitabilityVerified: false,
    status: reasons.length === 0 ? "paper-ready" : "blocked",
    reasons,
    paperAmountYen: reasons.length === 0 ? input.requestedYen : null,
    estimatedRoundTripCostYen: cost,
    remainingLiquidYen: remaining,
  });
  // External adapters must schema-validate payloads before calling this typed API.
  const amounts = [
    input.nowMs, input.requestedYen, input.totalDepositedYen,
    input.liquidBalanceYen, input.committedPrincipalYen, input.balanceAtMs,
    input.exitReserveYen, input.maxRoundTripCostYen,
  ];
  if (
    !amounts.every(whole) || input.requestedYen === 0 || input.exitReserveYen === 0 ||
    input.maxRoundTripCostYen >= input.requestedYen ||
    typeof input.emergencyStop !== "boolean" ||
    !address(input.walletAddress) || !address(input.inputToken) ||
    !address(input.outputToken) ||
    input.inputToken.toLowerCase() === input.outputToken.toLowerCase()
  ) {
    reasons.push("INVALID_INPUT");
    return result();
  }

  if (input.chainId !== SMALL_CAPITAL_POLICY.chainId) reasons.push("UNSUPPORTED_CHAIN");
  if (input.emergencyStop) reasons.push("EMERGENCY_STOP");
  if (input.dataQuality !== "healthy") reasons.push("DATA_NOT_HEALTHY");
  if (input.contractSafety !== "pass") reasons.push("CONTRACT_NOT_VERIFIED");
  if (input.totalDepositedYen > SMALL_CAPITAL_POLICY.maxFundingYen) reasons.push("FUNDING_CAP_EXCEEDED");
  if (input.requestedYen > SMALL_CAPITAL_POLICY.maxOrderYen) reasons.push("ORDER_CAP_EXCEEDED");
  if (!fresh(input.balanceAtMs, input.nowMs, SMALL_CAPITAL_POLICY.balanceMaxAgeMs)) {
    reasons.push("BALANCE_STALE");
  }
  const quote = input.quote;
  if (!quote) {
    reasons.push("QUOTE_MISSING");
    return result();
  }
  if (
    ![quote.amountInYen, quote.sellMinimumOutYen, quote.additionalBuyFeeYen,
      quote.additionalSellFeeYen, quote.quotedAtMs, quote.expiresAtMs,
      quote.valuationAtMs].every(whole) ||
    quote.amountInYen === 0 || quote.sellMinimumOutYen === 0 ||
    !units(quote.buyMinimumOutUnits) || !units(quote.sellAmountInUnits) ||
    !address(quote.walletAddress) || !address(quote.recipientAddress) ||
    !address(quote.inputToken) || !address(quote.outputToken)
  ) {
    reasons.push("QUOTE_INVALID");
    return result();
  }
  if (
    quote.chainId !== input.chainId || quote.amountInYen !== input.requestedYen ||
    quote.walletAddress.toLowerCase() !== input.walletAddress.toLowerCase() ||
    quote.recipientAddress.toLowerCase() !== input.walletAddress.toLowerCase() ||
    quote.inputToken.toLowerCase() !== input.inputToken.toLowerCase() ||
    quote.outputToken.toLowerCase() !== input.outputToken.toLowerCase() ||
    quote.buyMinimumOutUnits !== quote.sellAmountInUnits
  ) reasons.push("QUOTE_MISMATCH");
  if (!fresh(quote.quotedAtMs, input.nowMs, SMALL_CAPITAL_POLICY.quoteMaxAgeMs)) {
    reasons.push("QUOTE_STALE");
  }
  if (quote.expiresAtMs <= input.nowMs || quote.expiresAtMs <= quote.quotedAtMs) {
    reasons.push("QUOTE_EXPIRED");
  }
  if (!fresh(quote.valuationAtMs, input.nowMs, SMALL_CAPITAL_POLICY.quoteMaxAgeMs)) {
    reasons.push("VALUATION_STALE");
  }
  // Integer arithmetic avoids overflow and prevents caps from being rounded up.
  const requested = BigInt(input.requestedYen);
  const buyFee = BigInt(quote.additionalBuyFeeYen);
  const sellFee = BigInt(quote.additionalSellFeeYen);
  const reserve = BigInt(input.exitReserveYen);
  const requiredLiquid = requested + buyFee + reserve;
  const capitalBudget = BigInt(Math.min(input.totalDepositedYen, SMALL_CAPITAL_POLICY.maxFundingYen));
  if (BigInt(input.committedPrincipalYen) + requiredLiquid > capitalBudget) {
    reasons.push("CAPITAL_BUDGET_EXCEEDED");
  }
  if (requiredLiquid > BigInt(input.liquidBalanceYen)) reasons.push("INSUFFICIENT_LIQUID_BALANCE");
  if (reserve < sellFee) reasons.push("EXIT_RESERVE_INSUFFICIENT");
  // Never credit a suspicious apparent round-trip gain against additional fees.
  const loss = requested > BigInt(quote.sellMinimumOutYen)
    ? requested - BigInt(quote.sellMinimumOutYen) : BigInt(0);
  const cost = loss + buyFee + sellFee;
  if (cost > BigInt(input.maxRoundTripCostYen)) reasons.push("ROUND_TRIP_COST_EXCEEDED");
  if (reasons.length > 0) return result();
  return result(Number(cost), Number(BigInt(input.liquidBalanceYen) - requested - buyFee));
}
