import "server-only";

import { z } from "zod";

import { BasePaperQuoteError, getBasePaperQuote } from "@/lib/base-paper-quote";
import {
  BaseWalletObservationError,
  type BaseWalletObservationErrorCode,
  getBaseWalletObservation,
} from "@/lib/base-wallet-observation";

const BASE_CHAIN_ID = 8453;
const MAX_UINT = (BigInt(1) << BigInt(256)) - BigInt(1);
const UNITS_PATTERN = /^(0|[1-9][0-9]{0,77})$/;

const KNOWN_INCOMPLETE_CHECKS = [
  "L1_FEE_COVERAGE_UNVERIFIED",
  "TOKEN_APPROVAL_COST_UNVERIFIED",
  "SIGNER_FEES_UNVERIFIED",
  "WALLET_BALANCE_UNVERIFIED",
  "EXECUTION_VALUATION_UNVERIFIED",
] as const;

// WALLET_BALANCE_UNVERIFIED is the only check resolved by this preflight.
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

export type BasePaperPreflightErrorCode =
  | "INVALID_AMOUNT"
  | "BASE_QUOTE_UNAVAILABLE"
  | "BASE_WALLET_UNAVAILABLE"
  | "PREFLIGHT_CHAIN_MISMATCH"
  | "PREFLIGHT_INVALID_OBSERVATION";

export class BasePaperPreflightError extends Error {
  public readonly sourceCode: string | null;

  constructor(public readonly code: BasePaperPreflightErrorCode, sourceCode: unknown = null) {
    super(code);
    this.name = "BasePaperPreflightError";
    // Only an allowlisted code from the matching source; never raw messages, URLs or bodies.
    const allowed = code === "BASE_QUOTE_UNAVAILABLE"
      ? QUOTE_SOURCE_CODES
      : code === "BASE_WALLET_UNAVAILABLE" ? WALLET_SOURCE_CODES : null;
    this.sourceCode = typeof sourceCode === "string" && allowed?.has(sourceCode) ? sourceCode : null;
  }
}

const unitsSchema = z.string().refine((value) => UNITS_PATTERN.test(value) && BigInt(value) <= MAX_UINT);
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

export interface BasePaperPreflightDependencies {
  getQuote?: (requestedYen: 500 | 1000) => Promise<unknown>;
  getWallet?: () => Promise<unknown>;
  now?: () => number;
}

type BlockReason =
  | "INSUFFICIENT_NATIVE_BALANCE"
  | "QUOTE_EXPIRED"
  | "EXECUTION_LOCKED"
  | "PREFLIGHT_CHECKS_INCOMPLETE";

/**
 * Unsigned paper preflight. No calldata, recipient, approval, signature or broadcast.
 * A covered swap input MUST NOT be converted into a paper-ready/live order.
 */
export async function getBasePaperPreflight(
  requestedYen: 500 | 1000,
  dependencies: BasePaperPreflightDependencies = {},
) {
  if (requestedYen !== 500 && requestedYen !== 1000) throw new BasePaperPreflightError("INVALID_AMOUNT");
  const getQuote = dependencies.getQuote ?? getBasePaperQuote;
  const getWallet = dependencies.getWallet ?? (() => getBaseWalletObservation());
  const now = dependencies.now ?? Date.now;

  // One attempt each, started in parallel. No retry, polling, cache or persistence.
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

  const observedAtMs = now();
  const quote = quoteSchema.safeParse(quoteResult.value);
  const wallet = walletSchema.safeParse(walletResult.value);
  if (
    !Number.isSafeInteger(observedAtMs) || observedAtMs <= 0 ||
    !quote.success || !wallet.success || quote.data.requestedYen !== requestedYen
  ) {
    throw new BasePaperPreflightError("PREFLIGHT_INVALID_OBSERVATION");
  }
  if (quote.data.chainId !== BASE_CHAIN_ID || wallet.data.chainId !== BASE_CHAIN_ID) {
    throw new BasePaperPreflightError("PREFLIGHT_CHAIN_MISMATCH");
  }

  // Compare integer wei directly; never via yen or floating point.
  const requiredInputWei = BigInt(quote.data.amountInWei);
  const nativeBalanceWei = BigInt(wallet.data.nativeBalanceWei);
  const swapInputCovered = nativeBalanceWei >= requiredInputWei;

  const blockReasons: BlockReason[] = [];
  if (!swapInputCovered) blockReasons.push("INSUFFICIENT_NATIVE_BALANCE");
  if (quote.data.quoteExpiresAtMs <= observedAtMs) blockReasons.push("QUOTE_EXPIRED");
  blockReasons.push("EXECUTION_LOCKED", "PREFLIGHT_CHECKS_INCOMPLETE");

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
    rpcRequests: 1 as const,
    blockReasons,
    incompleteChecks: [...REMAINING_INCOMPLETE_CHECKS],
  };
}
