import "server-only";

import { z } from "zod";

import {
  BaseExecutionStateObservationError,
  type BaseExecutionStateObservationErrorCode,
  getBaseExecutionStateObservation,
} from "@/lib/base-execution-state-observation";
import { BasePaperQuoteError, getBasePaperQuote } from "@/lib/base-paper-quote";
import {
  BaseWalletObservationError,
  type BaseWalletObservationErrorCode,
  getBaseWalletObservation,
} from "@/lib/base-wallet-observation";

const BASE_CHAIN_ID = 8453;
const BASE_USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const BASE_GAS_PRICE_ORACLE_ADDRESS = "0x420000000000000000000000000000000000000f";
const MAX_UINT = (BigInt(1) << BigInt(256)) - BigInt(1);
const MAX_UINT32 = (BigInt(1) << BigInt(32)) - BigInt(1);
const MAX_UINT64 = (BigInt(1) << BigInt(64)) - BigInt(1);
const UNITS_PATTERN = /^(0|[1-9][0-9]{0,77})$/;

const KNOWN_INCOMPLETE_CHECKS = [
  "L1_FEE_COVERAGE_UNVERIFIED",
  "TOKEN_APPROVAL_COST_UNVERIFIED",
  "SIGNER_FEES_UNVERIFIED",
  "WALLET_BALANCE_UNVERIFIED",
  "EXECUTION_VALUATION_UNVERIFIED",
] as const;

// Fixed order of checks that can remain. WALLET_BALANCE_UNVERIFIED is always resolved by this preflight;
// TOKEN_APPROVAL_COST_UNVERIFIED is resolved only when the SELL allowance covers the SELL input.
const REMAINING_INCOMPLETE_CHECKS = [
  "L1_FEE_COVERAGE_UNVERIFIED",
  "TOKEN_APPROVAL_COST_UNVERIFIED",
  "SIGNER_FEES_UNVERIFIED",
  "EXECUTION_VALUATION_UNVERIFIED",
] as const;

// Stable codes the existing libraries can throw. Anything else is reported as null.
const QUOTE_SOURCE_CODES: ReadonlySet<string> = new Set([
  "INVALID_AMOUNT",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "INVALID_PROVIDER_DATA",
  "PRICE_RESPONSE_INVALID",
  "BUY_ROUTE_RESPONSE_INVALID",
  "SELL_ROUTE_RESPONSE_INVALID",
  "PRICE_STALE",
  "QUOTE_MISMATCH",
  "QUOTE_STALE",
  "AMOUNT_TOO_LOW",
  "OBSERVATION_EXPIRED",
]);
const WALLET_SOURCE_CODES: ReadonlySet<string> = new Set([
  "BASE_WALLET_CONFIGURATION_MISSING",
  "BASE_RPC_UNAVAILABLE",
  "BASE_RPC_INVALID_RESPONSE",
  "BASE_RPC_WRONG_CHAIN",
  "BASE_RPC_STALE_BLOCK",
] satisfies BaseWalletObservationErrorCode[]);

// Every execution-state code maps to exactly one preflight code; the Record type keeps this exhaustive.
const EXECUTION_STATE_ERROR_TARGETS = {
  BASE_WALLET_CONFIGURATION_MISSING: "BASE_EXECUTION_STATE_UNAVAILABLE",
  BASE_RPC_UNAVAILABLE: "BASE_EXECUTION_STATE_UNAVAILABLE",
  BASE_RPC_INVALID_RESPONSE: "BASE_EXECUTION_STATE_UNAVAILABLE",
  BASE_RPC_WRONG_CHAIN: "BASE_EXECUTION_STATE_UNAVAILABLE",
  BASE_RPC_STALE_BLOCK: "BASE_EXECUTION_STATE_UNAVAILABLE",
  BASE_EXECUTION_STATE_UNEXPECTED_CODE: "BASE_EXECUTION_STATE_UNAVAILABLE",
  // Preflight validates the same quote fields first, so this is an input mismatch, not an outage.
  BASE_EXECUTION_STATE_INPUT_INVALID: "PREFLIGHT_INVALID_OBSERVATION",
} as const satisfies Record<BaseExecutionStateObservationErrorCode, BasePaperPreflightErrorCode>;

function executionStateSourceCodes(target: BasePaperPreflightErrorCode): ReadonlySet<string> {
  return new Set(Object.entries(EXECUTION_STATE_ERROR_TARGETS)
    .filter(([, mapped]) => mapped === target)
    .map(([code]) => code));
}
const EXECUTION_STATE_SOURCE_CODES = executionStateSourceCodes("BASE_EXECUTION_STATE_UNAVAILABLE");
const EXECUTION_STATE_INPUT_SOURCE_CODES = executionStateSourceCodes("PREFLIGHT_INVALID_OBSERVATION");

function executionStateErrorTarget(code: string): BasePaperPreflightErrorCode {
  return Object.prototype.hasOwnProperty.call(EXECUTION_STATE_ERROR_TARGETS, code)
    ? EXECUTION_STATE_ERROR_TARGETS[code as BaseExecutionStateObservationErrorCode]
    : "BASE_EXECUTION_STATE_UNAVAILABLE";
}

export type BasePaperPreflightErrorCode =
  | "INVALID_AMOUNT"
  | "BASE_QUOTE_UNAVAILABLE"
  | "BASE_WALLET_UNAVAILABLE"
  | "BASE_EXECUTION_STATE_UNAVAILABLE"
  | "PREFLIGHT_CHAIN_MISMATCH"
  | "PREFLIGHT_INVALID_OBSERVATION"
  | "PREFLIGHT_OBSERVATION_MISMATCH";

function allowedSourceCodes(code: BasePaperPreflightErrorCode): ReadonlySet<string> | null {
  switch (code) {
    case "BASE_QUOTE_UNAVAILABLE":
      return QUOTE_SOURCE_CODES;
    case "BASE_WALLET_UNAVAILABLE":
      return WALLET_SOURCE_CODES;
    case "BASE_EXECUTION_STATE_UNAVAILABLE":
      return EXECUTION_STATE_SOURCE_CODES;
    case "PREFLIGHT_INVALID_OBSERVATION":
      return EXECUTION_STATE_INPUT_SOURCE_CODES;
    default:
      return null;
  }
}

export class BasePaperPreflightError extends Error {
  public readonly sourceCode: string | null;

  constructor(public readonly code: BasePaperPreflightErrorCode, sourceCode: unknown = null) {
    super(code);
    this.name = "BasePaperPreflightError";
    // Only an allowlisted code from the matching source; never raw messages, URLs or bodies.
    const allowed = allowedSourceCodes(code);
    this.sourceCode = typeof sourceCode === "string" && allowed?.has(sourceCode) ? sourceCode : null;
  }
}

const unitsSchema = z.string().refine((value) => UNITS_PATTERN.test(value) && BigInt(value) <= MAX_UINT);
// Decimal integer strings bounded by an ABI width. Checked with BigInt; never converted to number.
function boundedUnitsSchema(maximum: bigint) {
  return z.string().refine((value) => UNITS_PATTERN.test(value) && BigInt(value) <= maximum);
}
const positiveUnitsSchema = unitsSchema.refine((value) => value !== "0");
const lowercaseAddressSchema = z.string().regex(/^0x[0-9a-f]{40}$/).refine((value) => !/^0x0{40}$/.test(value));
const incompleteChecksSchema = z.array(z.enum(KNOWN_INCOMPLETE_CHECKS));
const quoteSchema = z.object({
  mode: z.literal("paper"),
  executionLocked: z.literal(true),
  profitabilityVerified: z.literal(false),
  status: z.literal("observed"),
  readiness: z.literal("blocked"),
  chainId: z.number(),
  requestedYen: z.union([z.literal(500), z.literal(1000)]),
  amountInWei: unitsSchema.refine((value) => value !== "0"),
  quoteExpiresAtMs: z.number().int().positive().safe(),
  routerAddress: lowercaseAddressSchema,
  buyMinimumOutUsdcUnits: positiveUnitsSchema,
  incompleteChecks: incompleteChecksSchema,
});
const walletSchema = z.object({
  mode: z.literal("paper"),
  executionLocked: z.literal(true),
  status: z.literal("observed"),
  readiness: z.literal("blocked"),
  chainId: z.number(),
  walletAddress: z.string().regex(/^0x[0-9a-f]{40}$/),
  nativeBalanceWei: unitsSchema,
  usdcBalanceUnits: unitsSchema,
  rpcRequests: z.literal(1),
  incompleteChecks: incompleteChecksSchema,
});
// Observed fee inputs. Reported as-is; they never resolve an incomplete check.
const feeParametersSchema = z.object({
  oracleAddress: z.literal(BASE_GAS_PRICE_ORACLE_ADDRESS),
  l2BaseFeePerGasWei: unitsSchema,
  l1BaseFeeWei: unitsSchema,
  blobBaseFeeWei: unitsSchema,
  baseFeeScalar: unitsSchema,
  blobBaseFeeScalar: unitsSchema,
  fjord: z.boolean(),
  isthmus: z.boolean(),
  // Isthmus operator fee inputs from the L1Block predeploy, bounded by their ABI widths.
  operatorFeeScalar: boundedUnitsSchema(MAX_UINT32),
  operatorFeeConstant: boundedUnitsSchema(MAX_UINT64),
});
const executionStateSchema = z.object({
  mode: z.literal("paper"),
  executionLocked: z.literal(true),
  status: z.literal("observed"),
  readiness: z.literal("blocked"),
  chainId: z.number(),
  walletAddress: lowercaseAddressSchema,
  routerAddress: lowercaseAddressSchema,
  usdcAddress: z.literal(BASE_USDC_ADDRESS),
  smartAccountDeployed: z.boolean(),
  usdcAllowanceUnits: unitsSchema,
  buyLegAllowanceRequired: z.literal(false),
  sellLegInputUsdcUnits: positiveUnitsSchema,
  sellLegAllowanceCovered: z.boolean(),
  feeParameters: feeParametersSchema,
  rpcRequests: z.literal(1),
});

export interface BasePaperPreflightDependencies {
  getQuote?: (requestedYen: 500 | 1000) => Promise<unknown>;
  getWallet?: () => Promise<unknown>;
  getExecutionState?: (quote: unknown) => Promise<unknown>;
  now?: () => number;
}

type BlockReason =
  | "INSUFFICIENT_NATIVE_BALANCE"
  | "SMART_ACCOUNT_UNDEPLOYED"
  | "SELL_ALLOWANCE_INSUFFICIENT"
  | "QUOTE_EXPIRED"
  | "EXECUTION_LOCKED"
  | "PREFLIGHT_CHECKS_INCOMPLETE";

type PreflightIncompleteCheck =
  | (typeof REMAINING_INCOMPLETE_CHECKS)[number]
  | "SMART_ACCOUNT_DEPLOYMENT_COST_UNVERIFIED";

/**
 * Unsigned paper preflight. No calldata, recipient, approval, permit, signature, deployment or broadcast.
 * Observed blockers are reported only and never repaired.
 * A covered swap input MUST NOT be converted into a paper-ready/live order.
 */
export async function getBasePaperPreflight(
  requestedYen: 500 | 1000,
  dependencies: BasePaperPreflightDependencies = {},
) {
  if (requestedYen !== 500 && requestedYen !== 1000) throw new BasePaperPreflightError("INVALID_AMOUNT");
  const getQuote = dependencies.getQuote ?? getBasePaperQuote;
  const getWallet = dependencies.getWallet ?? (() => getBaseWalletObservation());
  const getExecutionState = dependencies.getExecutionState
    ?? ((quote: unknown) => getBaseExecutionStateObservation(quote));
  const now = dependencies.now ?? Date.now;

  // One attempt each; quote and wallet start in parallel. No retry, polling, cache or persistence.
  const [quoteResult, walletResult] = await Promise.allSettled([
    (async () => getQuote(requestedYen))(),
    (async () => getWallet())(),
  ]);
  // Quote failure takes precedence so the reported error is deterministic.
  if (quoteResult.status === "rejected") {
    const reason: unknown = quoteResult.reason;
    throw new BasePaperPreflightError(
      "BASE_QUOTE_UNAVAILABLE",
      reason instanceof BasePaperQuoteError ? reason.code : null,
    );
  }
  if (walletResult.status === "rejected") {
    const reason: unknown = walletResult.reason;
    throw new BasePaperPreflightError(
      "BASE_WALLET_UNAVAILABLE",
      reason instanceof BaseWalletObservationError ? reason.code : null,
    );
  }

  const quote = quoteSchema.safeParse(quoteResult.value);
  const wallet = walletSchema.safeParse(walletResult.value);
  if (!quote.success || !wallet.success || quote.data.requestedYen !== requestedYen) {
    throw new BasePaperPreflightError("PREFLIGHT_INVALID_OBSERVATION");
  }
  if (quote.data.chainId !== BASE_CHAIN_ID || wallet.data.chainId !== BASE_CHAIN_ID) {
    throw new BasePaperPreflightError("PREFLIGHT_CHAIN_MISMATCH");
  }

  // Execution state needs the quote's router, so it runs once, only after quote and wallet pass.
  let executionStateValue: unknown;
  try {
    executionStateValue = await getExecutionState(quoteResult.value);
  } catch (reason) {
    if (reason instanceof BaseExecutionStateObservationError) {
      throw new BasePaperPreflightError(executionStateErrorTarget(reason.code), reason.code);
    }
    throw new BasePaperPreflightError("BASE_EXECUTION_STATE_UNAVAILABLE");
  }

  const observedAtMs = now();
  const state = executionStateSchema.safeParse(executionStateValue);
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs <= 0 || !state.success) {
    throw new BasePaperPreflightError("PREFLIGHT_INVALID_OBSERVATION");
  }
  if (state.data.chainId !== BASE_CHAIN_ID) {
    throw new BasePaperPreflightError("PREFLIGHT_CHAIN_MISMATCH");
  }
  // Recompute rather than trust the reported comparison.
  const usdcAllowanceUnits = BigInt(state.data.usdcAllowanceUnits);
  const sellLegInputUsdcUnits = BigInt(state.data.sellLegInputUsdcUnits);
  const sellLegAllowanceCovered = usdcAllowanceUnits >= sellLegInputUsdcUnits;
  if (sellLegAllowanceCovered !== state.data.sellLegAllowanceCovered) {
    throw new BasePaperPreflightError("PREFLIGHT_INVALID_OBSERVATION");
  }
  if (
    state.data.walletAddress !== wallet.data.walletAddress ||
    state.data.routerAddress !== quote.data.routerAddress ||
    state.data.sellLegInputUsdcUnits !== quote.data.buyMinimumOutUsdcUnits
  ) {
    throw new BasePaperPreflightError("PREFLIGHT_OBSERVATION_MISMATCH");
  }

  // Compare integer wei directly; never via yen or floating point.
  const requiredInputWei = BigInt(quote.data.amountInWei);
  const nativeBalanceWei = BigInt(wallet.data.nativeBalanceWei);
  const swapInputCovered = nativeBalanceWei >= requiredInputWei;
  const smartAccountDeployed = state.data.smartAccountDeployed;

  // Fixed order: funding, account, approval, time, then the constant locks.
  const blockReasons: BlockReason[] = [];
  if (!swapInputCovered) blockReasons.push("INSUFFICIENT_NATIVE_BALANCE");
  if (!smartAccountDeployed) blockReasons.push("SMART_ACCOUNT_UNDEPLOYED");
  if (!sellLegAllowanceCovered) blockReasons.push("SELL_ALLOWANCE_INSUFFICIENT");
  if (quote.data.quoteExpiresAtMs <= observedAtMs) blockReasons.push("QUOTE_EXPIRED");
  blockReasons.push("EXECUTION_LOCKED", "PREFLIGHT_CHECKS_INCOMPLETE");

  // An allowance of at least the current SELL input needs no new approve transaction for this SELL,
  // so only then is the approval cost known to be zero. Every other cost stays unverified.
  const incompleteChecks: PreflightIncompleteCheck[] = REMAINING_INCOMPLETE_CHECKS.filter(
    (check) => !(sellLegAllowanceCovered && check === "TOKEN_APPROVAL_COST_UNVERIFIED"),
  );
  if (!smartAccountDeployed) incompleteChecks.push("SMART_ACCOUNT_DEPLOYMENT_COST_UNVERIFIED");

  return {
    mode: "paper" as const,
    executionLocked: true as const,
    profitabilityVerified: false as const,
    status: "blocked" as const,
    readiness: "blocked" as const,
    chainId: BASE_CHAIN_ID,
    walletAddress: wallet.data.walletAddress,
    requestedYen,
    requiredInputWei: requiredInputWei.toString(),
    nativeBalanceWei: nativeBalanceWei.toString(),
    usdcBalanceUnits: wallet.data.usdcBalanceUnits,
    swapInputCovered,
    reserveSufficient: null,
    quoteExpiresAtMs: quote.data.quoteExpiresAtMs,
    observedAtMs,
    // Legacy alias of walletRpcRequests, kept for compatibility. It is not the total.
    rpcRequests: 1 as const,
    walletRpcRequests: 1 as const,
    executionStateRpcRequests: 1 as const,
    totalRpcRequests: 2 as const,
    externalHttpRequests: 5 as const,
    routerAddress: state.data.routerAddress,
    smartAccountDeployed,
    usdcAllowanceUnits: usdcAllowanceUnits.toString(),
    buyLegAllowanceRequired: false as const,
    sellLegInputUsdcUnits: sellLegInputUsdcUnits.toString(),
    sellLegAllowanceCovered,
    // Observed fee inputs only. They do not prove L1 coverage, gas usage or any total cost.
    feeParameters: state.data.feeParameters,
    blockReasons,
    incompleteChecks,
  };
}
