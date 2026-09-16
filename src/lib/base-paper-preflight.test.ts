import { describe, expect, it, vi } from "vitest";

import {
  BaseExecutionStateObservationError,
  type BaseExecutionStateObservationErrorCode,
} from "@/lib/base-execution-state-observation";
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
const ROUTER = "0x2222222222222222222222222222222222222222";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const REQUIRED_WEI = "1000000000000000";
const SELL_INPUT = "2487500";
const ORACLE = "0x420000000000000000000000000000000000000f";
const FEE_PARAMETERS = {
  oracleAddress: ORACLE,
  l2BaseFeePerGasWei: "5000000",
  l1BaseFeeWei: "43830987",
  blobBaseFeeWei: "2497031",
  baseFeeScalar: "2269",
  blobBaseFeeScalar: "1055250",
  fjord: true,
  isthmus: true,
  jovian: true,
  operatorFeeScalar: "2000",
  operatorFeeConstant: "1000000",
};
const MAX_UINT32_TEXT = ((BigInt(1) << BigInt(32)) - BigInt(1)).toString();
const MAX_UINT64_TEXT = ((BigInt(1) << BigInt(64)) - BigInt(1)).toString();
const DEPLOYMENT_CHECK = "SMART_ACCOUNT_DEPLOYMENT_COST_UNVERIFIED";
const REMAINING_CHECKS = [
  "L1_FEE_COVERAGE_UNVERIFIED",
  "TOKEN_APPROVAL_COST_UNVERIFIED",
  "SIGNER_FEES_UNVERIFIED",
  "EXECUTION_VALUATION_UNVERIFIED",
];
// A SELL allowance that covers the SELL input resolves only the approval cost.
const COVERED_ALLOWANCE_CHECKS = [
  "L1_FEE_COVERAGE_UNVERIFIED",
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
    routerAddress: ROUTER,
    buyMinimumOutUsdcUnits: SELL_INPUT,
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

function executionState(overrides: Record<string, unknown> = {}) {
  return {
    mode: "paper",
    executionLocked: true,
    status: "observed",
    readiness: "blocked",
    chainId: 8453,
    walletAddress: WALLET,
    routerAddress: ROUTER,
    usdcAddress: USDC,
    smartAccountDeployed: true,
    usdcAllowanceUnits: SELL_INPUT,
    buyLegAllowanceRequired: false,
    sellLegInputUsdcUnits: SELL_INPUT,
    sellLegAllowanceCovered: true,
    feeParameters: { ...FEE_PARAMETERS },
    blockNumber: "123456",
    blockTimestampMs: NOW,
    observedAtMs: NOW,
    rpcRequests: 1,
    ...overrides,
  };
}

function stateWith(deployed: boolean, allowanceUnits: string) {
  return executionState({
    smartAccountDeployed: deployed,
    usdcAllowanceUnits: allowanceUnits,
    sellLegAllowanceCovered: BigInt(allowanceUnits) >= BigInt(SELL_INPUT),
  });
}

function fixture(
  quoteValue: unknown = quote(),
  walletValue: unknown = wallet(),
  now: () => number = () => NOW,
  stateValue: unknown = executionState(),
) {
  const getQuote = vi.fn<(requestedYen: 500 | 1000) => Promise<unknown>>().mockResolvedValue(quoteValue);
  const getWallet = vi.fn<() => Promise<unknown>>().mockResolvedValue(walletValue);
  const getExecutionState = vi.fn<(quote: unknown) => Promise<unknown>>().mockResolvedValue(stateValue);
  return { getQuote, getWallet, getExecutionState, dependencies: { getQuote, getWallet, getExecutionState, now } };
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
    const { getQuote, getWallet, getExecutionState, dependencies } = fixture();
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
      walletRpcRequests: 1,
      executionStateRpcRequests: 1,
      totalRpcRequests: 2,
      externalHttpRequests: 5,
      routerAddress: ROUTER,
      smartAccountDeployed: true,
      usdcAllowanceUnits: SELL_INPUT,
      buyLegAllowanceRequired: false,
      sellLegInputUsdcUnits: SELL_INPUT,
      sellLegAllowanceCovered: true,
      feeParameters: FEE_PARAMETERS,
      blockReasons: ["INSUFFICIENT_NATIVE_BALANCE", "EXECUTION_LOCKED", "PREFLIGHT_CHECKS_INCOMPLETE"],
      incompleteChecks: COVERED_ALLOWANCE_CHECKS,
    });
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(getQuote).toHaveBeenCalledWith(500);
    expect(getWallet).toHaveBeenCalledTimes(1);
    expect(getExecutionState).toHaveBeenCalledTimes(1);
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
    expect(result.incompleteChecks).toEqual(COVERED_ALLOWANCE_CHECKS);
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
    const quoteValue = quote({ requestedYen: 1000 });
    const { getQuote, getExecutionState, dependencies } = fixture(quoteValue);
    expect((await getBasePaperPreflight(1000, dependencies)).requestedYen).toBe(1000);
    expect(getQuote).toHaveBeenCalledWith(1000);
    expect(getExecutionState).toHaveBeenCalledTimes(1);
    expect(getExecutionState.mock.calls[0][0]).toBe(quoteValue);
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
    const getExecutionState = vi.fn(async () => executionState());
    const pending = getBasePaperPreflight(500, { getQuote, getWallet, getExecutionState, now: () => NOW });

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
    const { getExecutionState, dependencies } = fixture(quoteValue, walletValue);
    expect((await rejection(getBasePaperPreflight(500, dependencies))).code).toBe("PREFLIGHT_CHAIN_MISMATCH");
    expect(getExecutionState).not.toHaveBeenCalled();
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
    ["quote routerAddress missing", quote({ routerAddress: undefined }), wallet()],
    ["quote routerAddress uppercase", quote({ routerAddress: "0xABCDEF0000000000000000000000000000000001" }), wallet()],
    ["quote routerAddress zero", quote({ routerAddress: `0x${"0".repeat(40)}` }), wallet()],
    ["quote buyMinimumOutUsdcUnits missing", quote({ buyMinimumOutUsdcUnits: undefined }), wallet()],
    ["quote buyMinimumOutUsdcUnits zero", quote({ buyMinimumOutUsdcUnits: "0" }), wallet()],
    ["quote buyMinimumOutUsdcUnits decimal", quote({ buyMinimumOutUsdcUnits: "1.5" }), wallet()],
  ])("fails closed on malformed observation: %s", async (_label, quoteValue, walletValue) => {
    // Build mocks directly: fixture() defaults would replace an explicit undefined.
    const getQuote = vi.fn(async () => quoteValue);
    const getWallet = vi.fn(async () => walletValue);
    const getExecutionState = vi.fn(async () => executionState());
    const error = await rejection(getBasePaperPreflight(500, { getQuote, getWallet, getExecutionState, now: () => NOW }));
    expect(error.code).toBe("PREFLIGHT_INVALID_OBSERVATION");
    expect(getExecutionState).not.toHaveBeenCalled();
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
    const getExecutionState = vi.fn(async () => executionState());
    const error = await rejection(getBasePaperPreflight(500, { getQuote, getWallet, getExecutionState, now: () => NOW }));
    expect(error).toMatchObject({ code: "BASE_QUOTE_UNAVAILABLE", sourceCode: "PRICE_STALE" });
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(getWallet).toHaveBeenCalledTimes(1);
    expect(getExecutionState).not.toHaveBeenCalled();
  });

  it.each([0, 499, 1001, Number.NaN])("makes no observations for unsupported amount %s", async (amount) => {
    const { getQuote, getWallet, getExecutionState, dependencies } = fixture();
    expect((await rejection(getBasePaperPreflight(amount as 500, dependencies))).code).toBe("INVALID_AMOUNT");
    expect(getQuote).not.toHaveBeenCalled();
    expect(getWallet).not.toHaveBeenCalled();
    expect(getExecutionState).not.toHaveBeenCalled();
  });

  it("filters source codes in the error constructor itself", () => {
    expect(new BasePaperPreflightError("PREFLIGHT_CHAIN_MISMATCH", "PRICE_STALE").sourceCode).toBeNull();
    expect(new BasePaperPreflightError("BASE_WALLET_UNAVAILABLE", "PRICE_STALE").sourceCode).toBeNull();
    expect(new BasePaperPreflightError("BASE_QUOTE_UNAVAILABLE", { code: "PRICE_STALE" }).sourceCode).toBeNull();
    expect(new BasePaperPreflightError("BASE_EXECUTION_STATE_UNAVAILABLE", "BASE_EXECUTION_STATE_INPUT_INVALID").sourceCode).toBeNull();
    expect(new BasePaperPreflightError("PREFLIGHT_INVALID_OBSERVATION", "BASE_RPC_UNAVAILABLE").sourceCode).toBeNull();
    expect(new BasePaperPreflightError("BASE_QUOTE_UNAVAILABLE", "BASE_EXECUTION_STATE_UNEXPECTED_CODE").sourceCode).toBeNull();
    expect(new BasePaperPreflightError("PREFLIGHT_OBSERVATION_MISMATCH", "BASE_RPC_UNAVAILABLE").sourceCode).toBeNull();
  });

  it("starts execution state only after quote and wallet settle, with the same quote object", async () => {
    const quoteValue = quote();
    let resolveQuote: (value: unknown) => void = () => undefined;
    let resolveWallet: (value: unknown) => void = () => undefined;
    const getQuote = vi.fn(() => new Promise<unknown>((resolve) => { resolveQuote = resolve; }));
    const getWallet = vi.fn(() => new Promise<unknown>((resolve) => { resolveWallet = resolve; }));
    const getExecutionState = vi.fn<(quote: unknown) => Promise<unknown>>()
      .mockImplementation(async () => executionState());
    const pending = getBasePaperPreflight(500, { getQuote, getWallet, getExecutionState, now: () => NOW });

    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(getWallet).toHaveBeenCalledTimes(1);
    resolveQuote(quoteValue);
    await delay(0);
    expect(getExecutionState).not.toHaveBeenCalled();
    resolveWallet(wallet());
    await pending;
    expect(getExecutionState).toHaveBeenCalledTimes(1);
    expect(getExecutionState.mock.calls[0][0]).toBe(quoteValue);
  });

  it("reads the observation time only after execution state completes", async () => {
    let resolveState: (value: unknown) => void = () => undefined;
    const getExecutionState = vi.fn(() => new Promise<unknown>((resolve) => { resolveState = resolve; }));
    const now = vi.fn(() => NOW);
    const { getQuote, getWallet } = fixture();
    const pending = getBasePaperPreflight(500, { getQuote, getWallet, getExecutionState, now });

    await delay(0);
    expect(getExecutionState).toHaveBeenCalledTimes(1);
    expect(now).not.toHaveBeenCalled();
    resolveState(executionState());
    await pending;
    expect(now).toHaveBeenCalledTimes(1);
  });

  it.each<{ label: string; deployed: boolean; allowance: string; reasons: string[]; checks: string[] }>([
    {
      label: "deployed, allowance above input",
      deployed: true,
      allowance: (BigInt(SELL_INPUT) + BigInt(1)).toString(),
      reasons: [],
      checks: COVERED_ALLOWANCE_CHECKS,
    },
    {
      label: "deployed, allowance equals input",
      deployed: true,
      allowance: SELL_INPUT,
      reasons: [],
      checks: COVERED_ALLOWANCE_CHECKS,
    },
    {
      label: "deployed, allowance one unit short",
      deployed: true,
      allowance: (BigInt(SELL_INPUT) - BigInt(1)).toString(),
      reasons: ["SELL_ALLOWANCE_INSUFFICIENT"],
      checks: REMAINING_CHECKS,
    },
    { label: "deployed, zero allowance", deployed: true, allowance: "0", reasons: ["SELL_ALLOWANCE_INSUFFICIENT"], checks: REMAINING_CHECKS },
    {
      label: "undeployed, allowance above input",
      deployed: false,
      allowance: (BigInt(SELL_INPUT) + BigInt(1)).toString(),
      reasons: ["SMART_ACCOUNT_UNDEPLOYED"],
      checks: [...COVERED_ALLOWANCE_CHECKS, DEPLOYMENT_CHECK],
    },
    {
      label: "undeployed, allowance equals input",
      deployed: false,
      allowance: SELL_INPUT,
      reasons: ["SMART_ACCOUNT_UNDEPLOYED"],
      checks: [...COVERED_ALLOWANCE_CHECKS, DEPLOYMENT_CHECK],
    },
    {
      label: "undeployed, allowance one unit short",
      deployed: false,
      allowance: (BigInt(SELL_INPUT) - BigInt(1)).toString(),
      reasons: ["SMART_ACCOUNT_UNDEPLOYED", "SELL_ALLOWANCE_INSUFFICIENT"],
      checks: [...REMAINING_CHECKS, DEPLOYMENT_CHECK],
    },
    {
      label: "undeployed, zero allowance",
      deployed: false,
      allowance: "0",
      reasons: ["SMART_ACCOUNT_UNDEPLOYED", "SELL_ALLOWANCE_INSUFFICIENT"],
      checks: [...REMAINING_CHECKS, DEPLOYMENT_CHECK],
    },
  ])("reports execution state without repairing it: $label", async ({ deployed, allowance, reasons, checks }) => {
    const { dependencies } = fixture(quote(), wallet({ nativeBalanceWei: REQUIRED_WEI }), () => NOW, stateWith(deployed, allowance));
    const result = await getBasePaperPreflight(500, dependencies);

    expect(result).toMatchObject({
      smartAccountDeployed: deployed,
      usdcAllowanceUnits: allowance,
      buyLegAllowanceRequired: false,
      sellLegInputUsdcUnits: SELL_INPUT,
      sellLegAllowanceCovered: BigInt(allowance) >= BigInt(SELL_INPUT),
      mode: "paper",
      executionLocked: true,
      profitabilityVerified: false,
      status: "blocked",
      readiness: "blocked",
      reserveSufficient: null,
    });
    expect(result.blockReasons).toEqual([...reasons, "EXECUTION_LOCKED", "PREFLIGHT_CHECKS_INCOMPLETE"]);
    expect(result.incompleteChecks).toEqual(checks);
    const covered = BigInt(allowance) >= BigInt(SELL_INPUT);
    expect(result.incompleteChecks.includes("TOKEN_APPROVAL_COST_UNVERIFIED")).toBe(!covered);
    expect(result.blockReasons.includes("SELL_ALLOWANCE_INSUFFICIENT")).toBe(!covered);
    expect(result.incompleteChecks.includes("SMART_ACCOUNT_DEPLOYMENT_COST_UNVERIFIED")).toBe(!deployed);
    expect(result.blockReasons).toContain("PREFLIGHT_CHECKS_INCOMPLETE");
  });

  it("keeps every block reason and incomplete check in a fixed order", async () => {
    const { dependencies } = fixture(quote({ quoteExpiresAtMs: NOW }), wallet(), () => NOW, stateWith(false, "0"));
    const result = await getBasePaperPreflight(500, dependencies);
    expect(result.blockReasons).toEqual([
      "INSUFFICIENT_NATIVE_BALANCE",
      "SMART_ACCOUNT_UNDEPLOYED",
      "SELL_ALLOWANCE_INSUFFICIENT",
      "QUOTE_EXPIRED",
      "EXECUTION_LOCKED",
      "PREFLIGHT_CHECKS_INCOMPLETE",
    ]);
    expect(result.incompleteChecks).toEqual([...REMAINING_CHECKS, DEPLOYMENT_CHECK]);
    expect(result).toMatchObject({ executionLocked: true, profitabilityVerified: false, reserveSufficient: null });
  });

  it("keeps the remaining incomplete checks in a fixed order when the allowance is covered", async () => {
    const { dependencies } = fixture(quote(), wallet(), () => NOW, stateWith(false, SELL_INPUT));
    const result = await getBasePaperPreflight(500, dependencies);
    expect(result.incompleteChecks).toEqual([
      "L1_FEE_COVERAGE_UNVERIFIED",
      "SIGNER_FEES_UNVERIFIED",
      "EXECUTION_VALUATION_UNVERIFIED",
      "SMART_ACCOUNT_DEPLOYMENT_COST_UNVERIFIED",
    ]);
    expect(result.blockReasons).toEqual([
      "INSUFFICIENT_NATIVE_BALANCE",
      "SMART_ACCOUNT_UNDEPLOYED",
      "EXECUTION_LOCKED",
      "PREFLIGHT_CHECKS_INCOMPLETE",
    ]);
  });

  it.each([
    "BASE_WALLET_CONFIGURATION_MISSING", "BASE_RPC_UNAVAILABLE", "BASE_RPC_INVALID_RESPONSE",
    "BASE_RPC_WRONG_CHAIN", "BASE_RPC_STALE_BLOCK", "BASE_EXECUTION_STATE_UNEXPECTED_CODE",
  ] as const)("reports allowlisted execution state code %s once without retry", async (code) => {
    const { dependencies, getQuote, getWallet, getExecutionState } = fixture();
    getExecutionState.mockRejectedValueOnce(new BaseExecutionStateObservationError(code));
    const error = await rejection(getBasePaperPreflight(500, dependencies));
    expect(error).toMatchObject({
      code: "BASE_EXECUTION_STATE_UNAVAILABLE",
      sourceCode: code,
      message: "BASE_EXECUTION_STATE_UNAVAILABLE",
    });
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(getWallet).toHaveBeenCalledTimes(1);
    expect(getExecutionState).toHaveBeenCalledTimes(1);
  });

  it("classifies execution state input rejection as an invalid observation, not an outage", async () => {
    const { dependencies, getExecutionState } = fixture();
    getExecutionState.mockRejectedValueOnce(new BaseExecutionStateObservationError("BASE_EXECUTION_STATE_INPUT_INVALID"));
    const error = await rejection(getBasePaperPreflight(500, dependencies));
    expect(error).toMatchObject({
      code: "PREFLIGHT_INVALID_OBSERVATION",
      sourceCode: "BASE_EXECUTION_STATE_INPUT_INVALID",
    });
  });

  it.each([
    new BaseExecutionStateObservationError("PRICE_STALE" as BaseExecutionStateObservationErrorCode),
    new BaseExecutionStateObservationError("toString" as BaseExecutionStateObservationErrorCode),
    new BaseExecutionStateObservationError("https://rpc.example/secret" as BaseExecutionStateObservationErrorCode),
    new Error("private rpc secret"),
    Object.assign(new Error("secret"), { code: "BASE_RPC_UNAVAILABLE" }),
    "secret string rejection",
  ])("does not leak non-allowlisted execution state failures %#", async (reason) => {
    const { dependencies, getExecutionState } = fixture();
    getExecutionState.mockRejectedValueOnce(reason);
    const error = await rejection(getBasePaperPreflight(500, dependencies));
    expect(error).toMatchObject({ code: "BASE_EXECUTION_STATE_UNAVAILABLE", sourceCode: null });
    expect(JSON.stringify({ ...error, message: error.message, stack: error.stack })).not.toContain("secret");
  });

  it.each(["quote", "wallet"] as const)("does not observe execution state after a %s failure", async (source) => {
    const { dependencies, getQuote, getWallet, getExecutionState } = fixture();
    if (source === "quote") getQuote.mockRejectedValueOnce(new BasePaperQuoteError("QUOTE_STALE"));
    else getWallet.mockRejectedValueOnce(new BaseWalletObservationError("BASE_RPC_UNAVAILABLE"));
    getExecutionState.mockRejectedValue(new BaseExecutionStateObservationError("BASE_RPC_UNAVAILABLE"));
    const error = await rejection(getBasePaperPreflight(500, dependencies));
    expect(error.code).toBe(source === "quote" ? "BASE_QUOTE_UNAVAILABLE" : "BASE_WALLET_UNAVAILABLE");
    expect(getExecutionState).not.toHaveBeenCalled();
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["undefined", undefined],
    ["mode", executionState({ mode: "live" })],
    ["executionLocked", executionState({ executionLocked: false })],
    ["status", executionState({ status: "blocked" })],
    ["readiness", executionState({ readiness: "ready" })],
    ["walletAddress uppercase", executionState({ walletAddress: "0xABC1111111111111111111111111111111111111" })],
    ["routerAddress zero", executionState({ routerAddress: `0x${"0".repeat(40)}` })],
    ["usdcAddress", executionState({ usdcAddress: ROUTER })],
    ["smartAccountDeployed string", executionState({ smartAccountDeployed: "false" })],
    ["usdcAllowanceUnits negative", executionState({ usdcAllowanceUnits: "-1" })],
    ["usdcAllowanceUnits hex", executionState({ usdcAllowanceUnits: "0x0" })],
    ["usdcAllowanceUnits number", executionState({ usdcAllowanceUnits: 0 })],
    ["usdcAllowanceUnits over uint256", executionState({ usdcAllowanceUnits: (BigInt(1) << BigInt(256)).toString() })],
    ["buyLegAllowanceRequired", executionState({ buyLegAllowanceRequired: true })],
    ["sellLegInputUsdcUnits zero", executionState({ sellLegInputUsdcUnits: "0" })],
    ["covered reported with zero allowance", executionState({ usdcAllowanceUnits: "0", sellLegAllowanceCovered: true })],
    ["not covered reported with sufficient allowance", executionState({ sellLegAllowanceCovered: false })],
    ["rpcRequests", executionState({ rpcRequests: 2 })],
    ["feeParameters missing", executionState({ feeParameters: undefined })],
    ["feeParameters null", executionState({ feeParameters: null })],
    ["feeParameters oracleAddress", executionState({ feeParameters: { ...FEE_PARAMETERS, oracleAddress: ROUTER } })],
    ["feeParameters l1BaseFeeWei hex", executionState({ feeParameters: { ...FEE_PARAMETERS, l1BaseFeeWei: "0x1" } })],
    ["feeParameters l1BaseFeeWei number", executionState({ feeParameters: { ...FEE_PARAMETERS, l1BaseFeeWei: 1 } })],
    ["feeParameters baseFeeScalar negative", executionState({ feeParameters: { ...FEE_PARAMETERS, baseFeeScalar: "-1" } })],
    ["feeParameters l2BaseFeePerGasWei decimal", executionState({ feeParameters: { ...FEE_PARAMETERS, l2BaseFeePerGasWei: "1.5" } })],
    ["feeParameters fjord string", executionState({ feeParameters: { ...FEE_PARAMETERS, fjord: "true" } })],
    ["feeParameters isthmus missing", executionState({ feeParameters: { ...FEE_PARAMETERS, isthmus: undefined } })],
    ["operatorFeeScalar missing", executionState({ feeParameters: { ...FEE_PARAMETERS, operatorFeeScalar: undefined } })],
    ["operatorFeeConstant missing", executionState({ feeParameters: { ...FEE_PARAMETERS, operatorFeeConstant: undefined } })],
    ["operatorFeeScalar number", executionState({ feeParameters: { ...FEE_PARAMETERS, operatorFeeScalar: 2000 } })],
    ["operatorFeeScalar negative", executionState({ feeParameters: { ...FEE_PARAMETERS, operatorFeeScalar: "-1" } })],
    ["operatorFeeScalar exponent", executionState({ feeParameters: { ...FEE_PARAMETERS, operatorFeeScalar: "2e3" } })],
    ["operatorFeeScalar leading zero", executionState({ feeParameters: { ...FEE_PARAMETERS, operatorFeeScalar: "02000" } })],
    ["operatorFeeScalar above uint32", executionState({ feeParameters: { ...FEE_PARAMETERS, operatorFeeScalar: (BigInt(1) << BigInt(32)).toString() } })],
    ["operatorFeeConstant above uint64", executionState({ feeParameters: { ...FEE_PARAMETERS, operatorFeeConstant: (BigInt(1) << BigInt(64)).toString() } })],
    ["operatorFeeConstant decimal", executionState({ feeParameters: { ...FEE_PARAMETERS, operatorFeeConstant: "1.5" } })],
    ["operatorFeeConstant hex", executionState({ feeParameters: { ...FEE_PARAMETERS, operatorFeeConstant: "0x1" } })],
    ["feeParameters jovian missing", executionState({ feeParameters: { ...FEE_PARAMETERS, jovian: undefined } })],
    ["feeParameters jovian null", executionState({ feeParameters: { ...FEE_PARAMETERS, jovian: null } })],
    ["feeParameters jovian string", executionState({ feeParameters: { ...FEE_PARAMETERS, jovian: "true" } })],
    ["feeParameters jovian number", executionState({ feeParameters: { ...FEE_PARAMETERS, jovian: 1 } })],
  ])("fails closed on malformed execution state: %s", async (_label, stateValue) => {
    // Build mocks directly: fixture() defaults would replace an explicit undefined.
    const getQuote = vi.fn(async () => quote());
    const getWallet = vi.fn(async () => wallet());
    const getExecutionState = vi.fn(async () => stateValue);
    const error = await rejection(getBasePaperPreflight(500, { getQuote, getWallet, getExecutionState, now: () => NOW }));
    expect(error.code).toBe("PREFLIGHT_INVALID_OBSERVATION");
  });

  it.each([true, false])("publishes the observed Jovian activation state (%s) without unlocking anything", async (jovian) => {
    const feeParameters = { ...FEE_PARAMETERS, jovian };
    const { dependencies } = fixture(quote(), wallet(), () => NOW, executionState({ feeParameters }));
    const result = await getBasePaperPreflight(500, dependencies);

    expect(result.feeParameters.jovian).toBe(jovian);
    expect(result.feeParameters).toEqual(feeParameters);
    // Observing a fork flag proves no cost, so every safety value stays fixed.
    expect(result).toMatchObject({
      mode: "paper",
      executionLocked: true,
      profitabilityVerified: false,
      status: "blocked",
      readiness: "blocked",
      reserveSufficient: null,
      walletRpcRequests: 1,
      executionStateRpcRequests: 1,
      totalRpcRequests: 2,
      externalHttpRequests: 5,
    });
    expect(result.blockReasons).toEqual(["INSUFFICIENT_NATIVE_BALANCE", "EXECUTION_LOCKED", "PREFLIGHT_CHECKS_INCOMPLETE"]);
    expect(result.incompleteChecks).toEqual(COVERED_ALLOWANCE_CHECKS);
    expect(result.incompleteChecks).toContain("L1_FEE_COVERAGE_UNVERIFIED");
    expect(result.incompleteChecks).toContain("EXECUTION_VALUATION_UNVERIFIED");
  });

  it.each([
    ["zero", "0", "0"],
    ["uint32 and uint64 maximums", MAX_UINT32_TEXT, MAX_UINT64_TEXT],
    ["beyond 2^53", "4000", "9007199254740993"],
  ])("passes operator fee parameters through unchanged at %s", async (_label, scalar, constant) => {
    const feeParameters = { ...FEE_PARAMETERS, operatorFeeScalar: scalar, operatorFeeConstant: constant };
    const { dependencies } = fixture(quote(), wallet(), () => NOW, executionState({ feeParameters }));
    const result = await getBasePaperPreflight(500, dependencies);

    expect(result.feeParameters).toEqual(feeParameters);
    expect(result.blockReasons).toEqual(["INSUFFICIENT_NATIVE_BALANCE", "EXECUTION_LOCKED", "PREFLIGHT_CHECKS_INCOMPLETE"]);
    expect(result.incompleteChecks).toEqual(COVERED_ALLOWANCE_CHECKS);
    expect(result.incompleteChecks).toContain("L1_FEE_COVERAGE_UNVERIFIED");
    expect(result.incompleteChecks).toContain("EXECUTION_VALUATION_UNVERIFIED");
    expect(result).toMatchObject({
      executionLocked: true,
      profitabilityVerified: false,
      readiness: "blocked",
      status: "blocked",
      reserveSufficient: null,
    });
    // Preflight never reports a total cost; that field belongs to the quote response.
    expect(result).not.toHaveProperty("totalCostYen");
  });

  it("fails closed on execution state chainId mismatch", async () => {
    const { dependencies } = fixture(quote(), wallet(), () => NOW, executionState({ chainId: 84532 }));
    expect((await rejection(getBasePaperPreflight(500, dependencies))).code).toBe("PREFLIGHT_CHAIN_MISMATCH");
  });

  it.each<[string, Record<string, unknown>]>([
    ["walletAddress", { walletAddress: "0x3333333333333333333333333333333333333333" }],
    ["routerAddress", { routerAddress: "0x4444444444444444444444444444444444444444" }],
    ["sellLegInputUsdcUnits", { sellLegInputUsdcUnits: "2487501", usdcAllowanceUnits: "2487501" }],
  ])("fails closed when execution state %s does not match quote or wallet", async (_label, overrides) => {
    const { dependencies } = fixture(quote(), wallet(), () => NOW, executionState(overrides));
    const error = await rejection(getBasePaperPreflight(500, dependencies));
    expect(error).toMatchObject({ code: "PREFLIGHT_OBSERVATION_MISMATCH", sourceCode: null });
  });
});
