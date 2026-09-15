import { describe, expect, it, vi } from "vitest";

import { BasePaperQuoteError } from "@/lib/base-paper-quote";
import {
  BasePaperPreflightError,
  getBasePaperPreflight,
} from "@/lib/base-paper-preflight";
import {
  BaseWalletObservationError,
  type BaseWalletObservationErrorCode,
} from "@/lib/base-wallet-observation";

const NOW = Date.UTC(2026, 8, 15, 12);
const WALLET = "0x1111111111111111111111111111111111111111";
const REQUIRED_WEI = "1000000000000000";
const REMAINING_CHECKS = [
  "L1_FEE_COVERAGE_UNVERIFIED",
  "TOKEN_APPROVAL_COST_UNVERIFIED",
  "SIGNER_FEES_UNVERIFIED",
  "EXECUTION_VALUATION_UNVERIFIED",
];

function quote(overrides: Record<string, unknown> = {}) {
  return {
    mode: "paper",
    executionLocked: true,
    profitabilityVerified: false,
    status: "observed",
    readiness: "blocked",
    chainId: 8453,
    requestedYen: 500,
    amountInWei: REQUIRED_WEI,
    quoteExpiresAtMs: NOW + 10_000,
    incompleteChecks: [
      "L1_FEE_COVERAGE_UNVERIFIED", "TOKEN_APPROVAL_COST_UNVERIFIED",
      "SIGNER_FEES_UNVERIFIED", "WALLET_BALANCE_UNVERIFIED",
      "EXECUTION_VALUATION_UNVERIFIED",
    ],
    ...overrides,
  };
}

function wallet(overrides: Record<string, unknown> = {}) {
  return {
    mode: "paper",
    executionLocked: true,
    status: "observed",
    readiness: "blocked",
    chainId: 8453,
    walletAddress: WALLET,
    nativeBalanceWei: "0",
    usdcBalanceUnits: "0",
    rpcRequests: 1,
    incompleteChecks: [...REMAINING_CHECKS],
    ...overrides,
  };
}

function fixture(quoteValue: unknown = quote(), walletValue: unknown = wallet(), now: () => number = () => NOW) {
  const getQuote = vi.fn<(requestedYen: 500 | 1000) => Promise<unknown>>().mockResolvedValue(quoteValue);
  const getWallet = vi.fn<() => Promise<unknown>>().mockResolvedValue(walletValue);
  return { getQuote, getWallet, dependencies: { getQuote, getWallet, now } };
}

async function rejection(promise: Promise<unknown>): Promise<BasePaperPreflightError> {
  const error = await promise.then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(BasePaperPreflightError);
  return error as BasePaperPreflightError;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("unsigned Base paper preflight", () => {
  it("blocks a zero balance as INSUFFICIENT_NATIVE_BALANCE and observes each source once", async () => {
    const { getQuote, getWallet, dependencies } = fixture();
    const result = await getBasePaperPreflight(500, dependencies);

    expect(result).toEqual({
      mode: "paper",
      executionLocked: true,
      profitabilityVerified: false,
      status: "blocked",
      readiness: "blocked",
      chainId: 8453,
      walletAddress: WALLET,
      requestedYen: 500,
      requiredInputWei: REQUIRED_WEI,
      nativeBalanceWei: "0",
      usdcBalanceUnits: "0",
      swapInputCovered: false,
      reserveSufficient: null,
      quoteExpiresAtMs: NOW + 10_000,
      observedAtMs: NOW,
      rpcRequests: 1,
      blockReasons: ["INSUFFICIENT_NATIVE_BALANCE", "EXECUTION_LOCKED", "PREFLIGHT_CHECKS_INCOMPLETE"],
      incompleteChecks: REMAINING_CHECKS,
    });
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(getQuote).toHaveBeenCalledWith(500);
    expect(getWallet).toHaveBeenCalledTimes(1);
  });

  it("covers the swap input when balance equals required wei, but stays blocked and locked", async () => {
    const { dependencies } = fixture(quote(), wallet({ nativeBalanceWei: REQUIRED_WEI }));
    const result = await getBasePaperPreflight(500, dependencies);

    expect(result).toMatchObject({
      swapInputCovered: true,
      executionLocked: true,
      profitabilityVerified: false,
      status: "blocked",
      readiness: "blocked",
      reserveSufficient: null,
      blockReasons: ["EXECUTION_LOCKED", "PREFLIGHT_CHECKS_INCOMPLETE"],
    });
    expect(result.incompleteChecks).toEqual(REMAINING_CHECKS);
    expect(result.incompleteChecks).not.toContain("WALLET_BALANCE_UNVERIFIED");
  });

  it("does not cover the swap input when one wei short", async () => {
    const short = (BigInt(REQUIRED_WEI) - BigInt(1)).toString();
    const { dependencies } = fixture(quote(), wallet({ nativeBalanceWei: short }));
    const result = await getBasePaperPreflight(500, dependencies);
    expect(result.swapInputCovered).toBe(false);
    expect(result.blockReasons).toContain("INSUFFICIENT_NATIVE_BALANCE");
  });

  it("compares wei beyond floating-point precision exactly", async () => {
    const required = ((BigInt(1) << BigInt(60)) + BigInt(1)).toString();
    const balance = (BigInt(1) << BigInt(60)).toString();
    expect(Number(required)).toBe(Number(balance));
    const { dependencies } = fixture(quote({ amountInWei: required }), wallet({ nativeBalanceWei: balance }));
    expect((await getBasePaperPreflight(500, dependencies)).swapInputCovered).toBe(false);
  });

  it("requests a 1000 yen quote separately", async () => {
    const { getQuote, dependencies } = fixture(quote({ requestedYen: 1000 }));
    expect((await getBasePaperPreflight(1000, dependencies)).requestedYen).toBe(1000);
    expect(getQuote).toHaveBeenCalledWith(1000);
  });

  it.each([
    [NOW, true],
    [NOW - 1, true],
    [NOW + 1, false],
  ])("adds QUOTE_EXPIRED when quoteExpiresAtMs=%s is not after observation (%s)", async (expiresAt, expired) => {
    const { dependencies } = fixture(quote({ quoteExpiresAtMs: expiresAt }), wallet({ nativeBalanceWei: REQUIRED_WEI }));
    const result = await getBasePaperPreflight(500, dependencies);
    expect(result.blockReasons.includes("QUOTE_EXPIRED")).toBe(expired);
    expect(result).toMatchObject({ status: "blocked", readiness: "blocked", executionLocked: true });
  });

  it("starts quote and wallet observation in parallel", async () => {
    let resolveQuote: (value: unknown) => void = () => undefined;
    const getQuote = vi.fn(() => new Promise<unknown>((resolve) => { resolveQuote = resolve; }));
    const getWallet = vi.fn(async () => wallet({ nativeBalanceWei: REQUIRED_WEI }));
    const pending = getBasePaperPreflight(500, { getQuote, getWallet, now: () => NOW });

    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(getWallet).toHaveBeenCalledTimes(1);
    resolveQuote(quote());
    await expect(pending).resolves.toMatchObject({ swapInputCovered: true });
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(getWallet).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["quote", quote({ chainId: 1 }), wallet()],
    ["wallet", quote(), wallet({ chainId: 84532 })],
  ])("fails closed on %s chainId mismatch", async (_source, quoteValue, walletValue) => {
    const { dependencies } = fixture(quoteValue, walletValue);
    expect((await rejection(getBasePaperPreflight(500, dependencies))).code).toBe("PREFLIGHT_CHAIN_MISMATCH");
  });

  it.each([
    ["amountInWei exponent", quote({ amountInWei: "1e15" }), wallet()],
    ["amountInWei negative", quote({ amountInWei: "-1" }), wallet()],
    ["amountInWei hex", quote({ amountInWei: "0x1" }), wallet()],
    ["amountInWei zero", quote({ amountInWei: "0" }), wallet()],
    ["amountInWei leading zero", quote({ amountInWei: "01" }), wallet()],
    ["amountInWei number", quote({ amountInWei: 1_000_000_000_000_000 }), wallet()],
    ["amountInWei empty", quote({ amountInWei: "" }), wallet()],
    ["amountInWei over uint256", quote({ amountInWei: (BigInt(1) << BigInt(256)).toString() }), wallet()],
    ["nativeBalanceWei decimal", quote(), wallet({ nativeBalanceWei: "1.5" })],
    ["nativeBalanceWei hex", quote(), wallet({ nativeBalanceWei: "0x0" })],
    ["nativeBalanceWei null", quote(), wallet({ nativeBalanceWei: null })],
    ["nativeBalanceWei over uint256", quote(), wallet({ nativeBalanceWei: (BigInt(1) << BigInt(256)).toString() })],
    ["usdcBalanceUnits negative", quote(), wallet({ usdcBalanceUnits: "-1" })],
    ["requestedYen mismatch", quote({ requestedYen: 1000 }), wallet()],
    ["quoteExpiresAtMs string", quote({ quoteExpiresAtMs: String(NOW) }), wallet()],
    ["quote mode", quote({ mode: "live" }), wallet()],
    ["quote executionLocked", quote({ executionLocked: false }), wallet()],
    ["quote profitabilityVerified", quote({ profitabilityVerified: true }), wallet()],
    ["quote status", quote({ status: "blocked" }), wallet()],
    ["quote readiness", quote({ readiness: "ready" }), wallet()],
    ["wallet mode", quote(), wallet({ mode: "live" })],
    ["wallet executionLocked", quote(), wallet({ executionLocked: false })],
    ["wallet status", quote(), wallet({ status: "unavailable" })],
    ["wallet readiness", quote(), wallet({ readiness: "ready" })],
    ["wallet address", quote(), wallet({ walletAddress: "not-an-address" })],
    ["wallet rpcRequests", quote(), wallet({ rpcRequests: 2 })],
    ["quote unknown incomplete check", quote({ incompleteChecks: ["L1_FEE_COVERAGE_UNVERIFIED", "NEW_CHECK"] }), wallet()],
    ["wallet unknown incomplete check", quote(), wallet({ incompleteChecks: ["<script>"] })],
    ["quote incompleteChecks not array", quote({ incompleteChecks: "L1_FEE_COVERAGE_UNVERIFIED" }), wallet()],
    ["quote null", null, wallet()],
    ["wallet undefined", quote(), undefined],
  ])("fails closed on malformed observation: %s", async (_label, quoteValue, walletValue) => {
    // Build mocks directly: fixture() defaults would replace an explicit undefined.
    const getQuote = vi.fn(async () => quoteValue);
    const getWallet = vi.fn(async () => walletValue);
    const error = await rejection(getBasePaperPreflight(500, { getQuote, getWallet, now: () => NOW }));
    expect(error.code).toBe("PREFLIGHT_INVALID_OBSERVATION");
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "fails closed when now() returns %s", async (nowValue) => {
      const { dependencies } = fixture(quote(), wallet(), () => nowValue);
      expect((await rejection(getBasePaperPreflight(500, dependencies))).code).toBe("PREFLIGHT_INVALID_OBSERVATION");
    },
  );

  it.each([
    "INVALID_AMOUNT", "PROVIDER_RATE_LIMITED", "PROVIDER_UNAVAILABLE", "INVALID_PROVIDER_DATA",
    "PRICE_RESPONSE_INVALID", "BUY_ROUTE_RESPONSE_INVALID", "SELL_ROUTE_RESPONSE_INVALID",
    "PRICE_STALE", "QUOTE_MISMATCH", "QUOTE_STALE", "AMOUNT_TOO_LOW", "OBSERVATION_EXPIRED",
  ])("reports allowlisted quote code %s", async (code) => {
    const { dependencies, getQuote } = fixture();
    getQuote.mockRejectedValueOnce(new BasePaperQuoteError(code));
    const error = await rejection(getBasePaperPreflight(500, dependencies));
    expect(error).toMatchObject({ code: "BASE_QUOTE_UNAVAILABLE", sourceCode: code, message: "BASE_QUOTE_UNAVAILABLE" });
  });

  it.each([
    "https://aggregator.example/private?key=secret",
    "PROVIDER_BODY secret upstream text",
    "WALLET_BALANCE_SECRET",
    "BASE_RPC_WRONG_CHAIN",
  ])("does not leak a non-allowlisted BasePaperQuoteError code %s", async (code) => {
    const { dependencies, getQuote } = fixture();
    getQuote.mockRejectedValueOnce(new BasePaperQuoteError(code));
    const error = await rejection(getBasePaperPreflight(500, dependencies));
    expect(error).toMatchObject({ code: "BASE_QUOTE_UNAVAILABLE", sourceCode: null, message: "BASE_QUOTE_UNAVAILABLE" });
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain("secret");
  });

  it.each([
    new Error("private upstream body secret"),
    Object.assign(new Error("secret"), { code: "PRICE_STALE" }),
    "secret string rejection",
  ])("does not trust raw quote failures %#", async (reason) => {
    const { dependencies, getQuote } = fixture();
    getQuote.mockRejectedValueOnce(reason);
    const error = await rejection(getBasePaperPreflight(500, dependencies));
    expect(error).toMatchObject({ code: "BASE_QUOTE_UNAVAILABLE", sourceCode: null });
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain("secret");
  });

  it.each([
    "BASE_WALLET_CONFIGURATION_MISSING", "BASE_RPC_UNAVAILABLE", "BASE_RPC_INVALID_RESPONSE",
    "BASE_RPC_WRONG_CHAIN", "BASE_RPC_STALE_BLOCK",
  ] as const)("reports allowlisted wallet code %s", async (code) => {
    const { dependencies, getWallet } = fixture();
    getWallet.mockRejectedValueOnce(new BaseWalletObservationError(code));
    const error = await rejection(getBasePaperPreflight(500, dependencies));
    expect(error).toMatchObject({ code: "BASE_WALLET_UNAVAILABLE", sourceCode: code });
  });

  it.each([
    new BaseWalletObservationError("PRICE_STALE" as BaseWalletObservationErrorCode),
    new BaseWalletObservationError("https://rpc.example/secret" as BaseWalletObservationErrorCode),
    new Error("private rpc secret"),
  ])("does not leak non-allowlisted wallet failures %#", async (reason) => {
    const { dependencies, getWallet } = fixture();
    getWallet.mockRejectedValueOnce(reason);
    const error = await rejection(getBasePaperPreflight(500, dependencies));
    expect(error).toMatchObject({ code: "BASE_WALLET_UNAVAILABLE", sourceCode: null });
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain("secret");
  });

  it.each([
    ["quote rejects first", 0, 10],
    ["wallet rejects first", 10, 0],
  ])("prefers the quote failure when both fail (%s)", async (_label, quoteDelay, walletDelay) => {
    const getQuote = vi.fn(async () => {
      await delay(quoteDelay);
      throw new BasePaperQuoteError("PRICE_STALE");
    });
    const getWallet = vi.fn(async () => {
      await delay(walletDelay);
      throw new BaseWalletObservationError("BASE_RPC_UNAVAILABLE");
    });
    const error = await rejection(getBasePaperPreflight(500, { getQuote, getWallet, now: () => NOW }));
    expect(error).toMatchObject({ code: "BASE_QUOTE_UNAVAILABLE", sourceCode: "PRICE_STALE" });
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(getWallet).toHaveBeenCalledTimes(1);
  });

  it.each([0, 499, 1001, Number.NaN])("makes no observations for unsupported amount %s", async (amount) => {
    const { getQuote, getWallet, dependencies } = fixture();
    expect((await rejection(getBasePaperPreflight(amount as 500, dependencies))).code).toBe("INVALID_AMOUNT");
    expect(getQuote).not.toHaveBeenCalled();
    expect(getWallet).not.toHaveBeenCalled();
  });

  it("filters source codes in the error constructor itself", () => {
    expect(new BasePaperPreflightError("PREFLIGHT_CHAIN_MISMATCH", "PRICE_STALE").sourceCode).toBeNull();
    expect(new BasePaperPreflightError("BASE_WALLET_UNAVAILABLE", "PRICE_STALE").sourceCode).toBeNull();
    expect(new BasePaperPreflightError("BASE_QUOTE_UNAVAILABLE", { code: "PRICE_STALE" }).sourceCode).toBeNull();
  });
});
