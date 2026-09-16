import { SMALL_CAPITAL_POLICY } from "@/lib/small-capital-paper";

/**
 * Pure planning arithmetic for Base paper funding. No network, environment,
 * clock, randomness, storage or mutation: the same input always yields the same
 * output. It is NOT a deposit amount, an execution budget or a trading permission.
 *
 * Only `principalShortfallWei` states a settled fact. Every other figure here is
 * built from provider estimates that exclude the costs listed in `unpricedCosts`,
 * so no value may be described as an amount that makes a trade possible.
 */

const WEI = BigInt("1000000000000000000");
const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
// Decimal integer strings only: no sign, no leading zero, no exponent, no hex.
const UNITS_PATTERN = /^(0|[1-9][0-9]{0,77})$/;
// Same shape as the quote's decimal valuation strings, so String(1e21) fails closed.
const DECIMAL_PATTERN = /^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$/;
// The two amounts the Base paper quote supports. The policy cap is checked separately.
const SUPPORTED_REQUEST_YEN: readonly number[] = [500, 1000];

// Fixed report order. Three entries are conditional; the rest always apply.
const UNPRICED_COST_ORDER = [
  "SMART_ACCOUNT_DEPLOYMENT",
  "USER_OPERATION_GAS",
  "BUNDLER_FEE",
  "PAYMASTER_FEE",
  "SIGNER_FEE",
  "APPROVAL_TRANSACTION",
  "BUNDLE_L1_FEE_ALLOCATION",
  "EXECUTION_TIME_OPERATOR_FEE",
  "PRICE_AND_GAS_MOVEMENT",
  "PROVIDER_L1_FEE",
] as const;

export type UnpricedCost = (typeof UNPRICED_COST_ORDER)[number];

export type BaseFundingPlanningErrorCode =
  | "FUNDING_PLANNING_INVALID_INPUT"
  | "FUNDING_PLANNING_OVERFLOW";

export class BaseFundingPlanningError extends Error {
  constructor(public readonly code: BaseFundingPlanningErrorCode) {
    // The message is the code itself: never an input value, path, URL or stack.
    super(code);
    this.name = "BaseFundingPlanningError";
  }
}

export interface BaseFundingPlanningInput {
  /** The quoted plan size. Must also stay within the policy order cap. */
  requestedYen: 500 | 1000;
  /** The quote's own input amount, taken as given and never recomputed here. */
  principalWei: string;
  /** Observed native balance. Zero is a valid observation, not a missing value. */
  nativeBalanceWei: string;
  /** Valuation used by the same quote, as a decimal number. */
  ethJpy: number;
  /** Round-trip shortfall plus provider gas, excluding any provider L1 fee. */
  knownCostEstimateYen: number;
  /** The same total including the provider L1 fee, or null when it was absent. */
  providerKnownCostEstimateYen: number | null;
  smartAccountDeployed: boolean;
  sellLegAllowanceCovered: boolean;
}

export interface BaseFundingPlanningResult {
  totalCapitalLimitYen: number;
  perTradeLimitYen: number;
  /** No cumulative deposit total exists here, so the funding cap is not judged. */
  capitalBudgetEvaluated: false;
  /** No approved reserve amount exists in the codebase, so none is invented. */
  policyReserveYen: null;
  requestedYen: 500 | 1000;
  principalWei: string;
  nativeBalanceWei: string;
  /** Settled fact: the balance is short of the quoted principal by this much. */
  principalShortfallWei: string;
  /** Which cost total the estimate was built from. */
  costBasis: "WITH_PROVIDER_L1_FEE" | "WITHOUT_PROVIDER_L1_FEE";
  estimatedKnownCostYen: number;
  /** The yen estimate converted upward at the quote's valuation. Reference only. */
  estimatedKnownCostWei: string;
  /** principal + estimated known cost. Not a required, minimum or sufficient amount. */
  estimatedFundingReferenceWei: string;
  /** Distance from the balance to that reference. Not a deposit recommendation. */
  estimatedFundingReferenceGapWei: string;
  planningTargetWei: null;
  planningShortfallWei: null;
  /** Unpriced costs remain, so sufficiency is never asserted either way. */
  fundingSufficient: null;
  unpricedCosts: UnpricedCost[];
}

function invalid(): never {
  throw new BaseFundingPlanningError("FUNDING_PLANNING_INVALID_INPUT");
}

function wholeYen(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid();
  return value as number;
}

function unitsBigInt(value: unknown, allowZero: boolean): bigint {
  if (typeof value !== "string" || !UNITS_PATTERN.test(value)) invalid();
  const parsed = BigInt(value as string);
  if (parsed > MAX_UINT256 || (!allowZero && parsed === BigInt(0))) invalid();
  return parsed;
}

// Exact decimal fraction, so no yen amount is ever converted through a float.
function decimalFraction(value: number): { numerator: bigint; denominator: bigint } {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) invalid();
  const text = String(value);
  if (!DECIMAL_PATTERN.test(text)) invalid();
  const [whole, fraction = ""] = text.split(".");
  const numerator = BigInt(whole + fraction);
  if (numerator === BigInt(0)) invalid();
  return { numerator, denominator: BigInt(10) ** BigInt(fraction.length) };
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - BigInt(1)) / denominator;
}

function shortfall(required: bigint, available: bigint): bigint {
  return required > available ? required - available : BigInt(0);
}

/**
 * Reports the settled principal shortfall and a reference figure built only from
 * already-estimated costs. A balance at or above any figure here does NOT mean a
 * trade is possible: every entry in `unpricedCosts` is still unmeasured.
 */
export function evaluateBaseFundingPlanning(
  input: BaseFundingPlanningInput,
): BaseFundingPlanningResult {
  if (typeof input !== "object" || input === null) invalid();

  const requestedYen = input.requestedYen;
  if (
    !SUPPORTED_REQUEST_YEN.includes(requestedYen) ||
    requestedYen > SMALL_CAPITAL_POLICY.maxOrderYen
  ) {
    invalid();
  }
  if (
    typeof input.smartAccountDeployed !== "boolean" ||
    typeof input.sellLegAllowanceCovered !== "boolean"
  ) {
    invalid();
  }

  const knownCostEstimateYen = wholeYen(input.knownCostEstimateYen);
  const providerKnownCostEstimateYen = input.providerKnownCostEstimateYen === null
    ? null
    : wholeYen(input.providerKnownCostEstimateYen);
  const { numerator, denominator } = decimalFraction(input.ethJpy);
  const principal = unitsBigInt(input.principalWei, false);
  const balance = unitsBigInt(input.nativeBalanceWei, true);

  // A missing provider L1 fee is never counted as zero: the basis changes instead
  // and PROVIDER_L1_FEE joins the unpriced list.
  const withProviderL1Fee = providerKnownCostEstimateYen !== null;
  const estimatedKnownCostYen = withProviderL1Fee
    ? (providerKnownCostEstimateYen as number)
    : knownCostEstimateYen;

  // Costs round up, so the reference is never understated by a rounding remainder.
  const estimatedKnownCostWei = ceilDiv(
    BigInt(estimatedKnownCostYen) * denominator * WEI,
    numerator,
  );
  if (estimatedKnownCostWei > MAX_UINT256) {
    throw new BaseFundingPlanningError("FUNDING_PLANNING_OVERFLOW");
  }
  const estimatedFundingReferenceWei = principal + estimatedKnownCostWei;
  if (estimatedFundingReferenceWei > MAX_UINT256) {
    throw new BaseFundingPlanningError("FUNDING_PLANNING_OVERFLOW");
  }

  const conditional: Partial<Record<UnpricedCost, boolean>> = {
    SMART_ACCOUNT_DEPLOYMENT: !input.smartAccountDeployed,
    APPROVAL_TRANSACTION: !input.sellLegAllowanceCovered,
    PROVIDER_L1_FEE: !withProviderL1Fee,
  };

  return {
    totalCapitalLimitYen: SMALL_CAPITAL_POLICY.maxFundingYen,
    perTradeLimitYen: SMALL_CAPITAL_POLICY.maxOrderYen,
    capitalBudgetEvaluated: false,
    policyReserveYen: null,
    requestedYen,
    principalWei: principal.toString(),
    nativeBalanceWei: balance.toString(),
    principalShortfallWei: shortfall(principal, balance).toString(),
    costBasis: withProviderL1Fee ? "WITH_PROVIDER_L1_FEE" : "WITHOUT_PROVIDER_L1_FEE",
    estimatedKnownCostYen,
    estimatedKnownCostWei: estimatedKnownCostWei.toString(),
    estimatedFundingReferenceWei: estimatedFundingReferenceWei.toString(),
    estimatedFundingReferenceGapWei: shortfall(estimatedFundingReferenceWei, balance).toString(),
    planningTargetWei: null,
    planningShortfallWei: null,
    fundingSufficient: null,
    unpricedCosts: UNPRICED_COST_ORDER.filter((cost) => conditional[cost] ?? true),
  };
}
