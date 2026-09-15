import { describe, expect, it, vi } from "vitest";

import {
  BaseExecutionStateObservationError,
  getBaseExecutionStateObservation,
} from "@/lib/base-execution-state-observation";

const NOW_MS = 1_789_430_700_000;
const NOW_SECONDS = Math.floor(NOW_MS / 1_000);
const WALLET = "0x1111111111111111111111111111111111111aBc"; // Mixed case to check normalization.
const WALLET_LOWER = WALLET.toLowerCase();
const ROUTER = "0x2222222222222222222222222222222222222222";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const REQUIRED_UNITS = "2487500";
const SECRET_RPC_URL = "https://base.example/rpc/secret-key-123";
const MISSING = Symbol("missing");

function environment(overrides: { BASE_RPC_URL?: string; BASE_WALLET_ADDRESS?: string } = {}) {
  return { BASE_RPC_URL: SECRET_RPC_URL, BASE_WALLET_ADDRESS: WALLET, ...overrides };
}

function quote(overrides: Record<string, unknown> = {}) {
  const value: Record<string, unknown> = {
    mode: "paper",
    executionLocked: true,
    profitabilityVerified: false,
    status: "observed",
    readiness: "blocked",
    chainId: 8453,
    routerAddress: ROUTER,
    buyAmountOutUsdcUnits: "2500000",
    buyMinimumOutUsdcUnits: REQUIRED_UNITS,
  };
  for (const [key, override] of Object.entries(overrides)) {
    if (override === MISSING) delete value[key];
    else value[key] = override;
  }
  return value;
}

function uint256(value: bigint | number | string) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

function replies(results: Partial<Record<1 | 2 | 3 | 4, unknown>> = {}) {
  const values: Record<number, unknown> = {
    1: "0x2105",
    2: { number: "0x1e240", timestamp: `0x${NOW_SECONDS.toString(16)}` },
    3: "0x",
    4: uint256(0),
    ...results,
  };
  // Out of order on purpose: replies are matched by id.
  return [4, 2, 3, 1].map((id) => ({ jsonrpc: "2.0", id, result: values[id] }));
}

function rpcResponse(body: unknown, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchReturning(body: unknown, status = 200) {
  return vi.fn<typeof fetch>().mockImplementation(async () => rpcResponse(body, status));
}

function observe(
  body: unknown,
  { quoteValue = quote(), nowMs = NOW_MS, env = environment() }: {
    quoteValue?: unknown;
    nowMs?: number;
    env?: ReturnType<typeof environment>;
  } = {},
) {
  const fetchImpl = fetchReturning(body);
  return {
    fetchImpl,
    result: getBaseExecutionStateObservation(quoteValue, { fetchImpl, nowMs, environment: env }),
  };
}

async function rejection(promise: Promise<unknown>): Promise<BaseExecutionStateObservationError> {
  const error = await promise.then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(BaseExecutionStateObservationError);
  const typed = error as BaseExecutionStateObservationError;
  expect(typed.message).toBe(typed.code);
  expect(JSON.stringify({ ...typed, message: typed.message, stack: typed.stack })).not.toContain("secret");
  return typed;
}

describe("Base execution state observation", () => {
  it("observes an undeployed account with zero allowance in one fixed batch POST", async () => {
    const { fetchImpl, result } = observe(replies());

    expect(await result).toEqual({
      mode: "paper",
      executionLocked: true,
      status: "observed",
      readiness: "blocked",
      chainId: 8453,
      walletAddress: WALLET_LOWER,
      routerAddress: ROUTER,
      usdcAddress: USDC,
      smartAccountDeployed: false,
      usdcAllowanceUnits: "0",
      buyLegAllowanceRequired: false,
      sellLegInputUsdcUnits: REQUIRED_UNITS,
      sellLegAllowanceCovered: false,
      blockNumber: "123456",
      blockTimestampMs: NOW_SECONDS * 1_000,
      observedAtMs: NOW_MS,
      rpcRequests: 1,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(SECRET_RPC_URL);
    expect(init).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
    const payload = JSON.parse(String(init?.body));
    expect(payload).toEqual([
      { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
      { jsonrpc: "2.0", id: 2, method: "eth_getBlockByNumber", params: ["latest", false] },
      { jsonrpc: "2.0", id: 3, method: "eth_getCode", params: [WALLET_LOWER, "latest"] },
      {
        jsonrpc: "2.0",
        id: 4,
        method: "eth_call",
        params: [{
          to: USDC,
          data: `0xdd62ed3e${"0".repeat(24)}${WALLET_LOWER.slice(2)}${"0".repeat(24)}${ROUTER.slice(2)}`,
        }, "latest"],
      },
    ]);
    expect(payload[3].params[0].data).toHaveLength(2 + 8 + 64 * 2);
  });

  it.each([
    ["minimal runtime code", "0x00"],
    ["proxy bytecode", "0x363d3d373d3d3d363d7300000000000000000000000000000000000000005af43d82803e903d91602b57fd5bf3"],
    ["uppercase hex", "0x6080604052ABCDEF"],
    ["EIP-170 maximum size", `0x${"00".repeat(24_576)}`],
    ["0xef0100 prefix with 22 bytes", `0xef0100${"a".repeat(38)}`],
    ["0xef0100 prefix with 24 bytes", `0xef0100${"a".repeat(42)}`],
  ])("reports a deployed account for non-empty code: %s", async (_label, code) => {
    const { result } = observe(replies({ 3: code }));
    expect(await result).toMatchObject({
      smartAccountDeployed: true,
      mode: "paper",
      executionLocked: true,
      status: "observed",
      readiness: "blocked",
    });
  });

  it.each([
    ["lowercase", `0xef0100${"a".repeat(40)}`],
    ["uppercase", `0xEF0100${"A".repeat(40)}`],
  ])("fails closed on an EIP-7702 delegation indicator (%s)", async (_label, code) => {
    const { fetchImpl, result } = observe(replies({ 3: code }));
    expect((await rejection(result)).code).toBe("BASE_EXECUTION_STATE_UNEXPECTED_CODE");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["zero", uint256(0), false],
    ["one unit short", uint256(BigInt(REQUIRED_UNITS) - BigInt(1)), false],
    ["exactly required", uint256(REQUIRED_UNITS), true],
    ["above required", uint256(BigInt(REQUIRED_UNITS) + BigInt(1)), true],
  ])("compares SELL allowance to the SELL input: %s", async (_label, allowance, covered) => {
    const { result } = observe(replies({ 4: allowance }));
    expect(await result).toMatchObject({
      usdcAllowanceUnits: BigInt(allowance).toString(),
      sellLegInputUsdcUnits: REQUIRED_UNITS,
      sellLegAllowanceCovered: covered,
      buyLegAllowanceRequired: false,
    });
  });

  it("uses buyMinimumOutUsdcUnits, not buyAmountOutUsdcUnits, as the SELL input", async () => {
    const { result } = observe(replies({ 4: uint256(REQUIRED_UNITS) }), {
      quoteValue: quote({ buyAmountOutUsdcUnits: "9999999999" }),
    });
    expect(await result).toMatchObject({ sellLegInputUsdcUnits: REQUIRED_UNITS, sellLegAllowanceCovered: true });
  });

  it("compares allowance beyond 2^53 exactly", async () => {
    const required = (BigInt(2) ** BigInt(53) + BigInt(1)).toString();
    const allowance = BigInt(2) ** BigInt(53);
    expect(Number(required)).toBe(Number(allowance));
    const { result } = observe(replies({ 4: uint256(allowance) }), {
      quoteValue: quote({ buyMinimumOutUsdcUnits: required }),
    });
    expect(await result).toMatchObject({
      usdcAllowanceUnits: "9007199254740992",
      sellLegInputUsdcUnits: "9007199254740993",
      sellLegAllowanceCovered: false,
    });
  });

  it("returns the maximum uint256 allowance as an exact string", async () => {
    const max = (BigInt(1) << BigInt(256)) - BigInt(1);
    const { result } = observe(replies({ 4: `0x${"f".repeat(64)}` }));
    expect(await result).toMatchObject({ usdcAllowanceUnits: max.toString(), sellLegAllowanceCovered: true });
  });

  it.each([
    ["odd length", "0x123"],
    ["non-hex", "0xzz"],
    ["missing 0x", "6080"],
    ["empty string", ""],
    ["number", 0],
    ["null", null],
    ["object", {}],
    ["above EIP-170 size", `0x${"00".repeat(24_577)}`],
  ])("rejects malformed eth_getCode data: %s", async (_label, code) => {
    const { result } = observe(replies({ 3: code }));
    expect((await rejection(result)).code).toBe("BASE_RPC_INVALID_RESPONSE");
  });

  it.each([
    ["31 bytes", `0x${"0".repeat(62)}`],
    ["33 bytes", `0x${"0".repeat(66)}`],
    ["quantity zero", "0x0"],
    ["quantity one", "0x1"],
    ["empty data", "0x"],
    ["non-hex", `0x${"g".repeat(64)}`],
    ["missing 0x", "0".repeat(64)],
    ["number", 0],
    ["null", null],
  ])("rejects allowance return data that is not a 32-byte uint256: %s", async (_label, allowance) => {
    const { result } = observe(replies({ 4: allowance }));
    expect((await rejection(result)).code).toBe("BASE_RPC_INVALID_RESPONSE");
  });

  it.each([
    ["missing chainId reply", replies().filter((reply) => reply.id !== 1)],
    ["missing block reply", replies().filter((reply) => reply.id !== 2)],
    ["missing code reply", replies().filter((reply) => reply.id !== 3)],
    ["missing allowance reply", replies().filter((reply) => reply.id !== 4)],
    ["duplicate code reply", [...replies(), { jsonrpc: "2.0", id: 3, result: "0x" }]],
    ["duplicate allowance reply", [...replies(), { jsonrpc: "2.0", id: 4, result: uint256(0) }]],
    ["error code reply", replies().map((reply) => reply.id === 3 ? { jsonrpc: "2.0", id: 3, error: { code: -32000 } } : reply)],
    ["error allowance reply", replies().map((reply) => reply.id === 4 ? { jsonrpc: "2.0", id: 4, error: { code: 3, message: "execution reverted" } } : reply)],
    ["null block", replies({ 2: null })],
    ["block number with leading zero", replies({ 2: { number: "0x01", timestamp: `0x${NOW_SECONDS.toString(16)}` } })],
    ["not a batch", { jsonrpc: "2.0", id: 1, result: "0x2105" }],
    ["invalid JSON", "not json"],
  ])("rejects incomplete or ambiguous RPC responses: %s", async (_label, body) => {
    const { fetchImpl, result } = observe(body);
    expect((await rejection(result)).code).toBe("BASE_RPC_INVALID_RESPONSE");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(["0x1", "0x14a34"])("rejects a non-Base chain %s", async (chainId) => {
    const { result } = observe(replies({ 1: chainId }));
    expect((await rejection(result)).code).toBe("BASE_RPC_WRONG_CHAIN");
  });

  it.each([
    ["61 seconds old", -61, "BASE_RPC_STALE_BLOCK"],
    ["6 seconds in the future", 6, "BASE_RPC_STALE_BLOCK"],
  ])("rejects a block that is %s", async (_label, offset, code) => {
    const block = { number: "0x1e240", timestamp: `0x${(NOW_SECONDS + offset).toString(16)}` };
    const { result } = observe(replies({ 2: block }));
    expect((await rejection(result)).code).toBe(code);
  });

  it.each([-60, 5])("accepts a block at the freshness boundary (%s seconds)", async (offset) => {
    const block = { number: "0x1e240", timestamp: `0x${(NOW_SECONDS + offset).toString(16)}` };
    const { result } = observe(replies({ 2: block }));
    expect((await result).status).toBe("observed");
  });

  it.each([429, 500, 503])("does not retry HTTP %s or expose the upstream body", async (status) => {
    const fetchImpl = fetchReturning("private upstream secret body", status);
    const promise = getBaseExecutionStateObservation(quote(), { fetchImpl, nowMs: NOW_MS, environment: environment() });
    expect((await rejection(promise)).code).toBe("BASE_RPC_UNAVAILABLE");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sanitizes transport failures and does not retry", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error(`connect failed ${SECRET_RPC_URL}`));
    const promise = getBaseExecutionStateObservation(quote(), { fetchImpl, nowMs: NOW_MS, environment: environment() });
    expect((await rejection(promise)).code).toBe("BASE_RPC_UNAVAILABLE");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing RPC URL", { BASE_RPC_URL: "" }],
    ["non-HTTP RPC URL", { BASE_RPC_URL: "wss://base.example/secret" }],
    ["invalid wallet", { BASE_WALLET_ADDRESS: "not-an-address" }],
    ["zero wallet", { BASE_WALLET_ADDRESS: `0x${"0".repeat(40)}` }],
  ])("fails closed on invalid configuration without RPC work: %s", async (_label, overrides) => {
    const { fetchImpl, result } = observe(replies(), { env: environment(overrides) });
    expect((await rejection(result)).code).toBe("BASE_WALLET_CONFIGURATION_MISSING");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["null quote", null],
    ["mode", quote({ mode: "live" })],
    ["executionLocked", quote({ executionLocked: false })],
    ["profitabilityVerified", quote({ profitabilityVerified: true })],
    ["status", quote({ status: "blocked" })],
    ["readiness", quote({ readiness: "ready" })],
    ["chainId", quote({ chainId: 1 })],
    ["router missing", quote({ routerAddress: MISSING })],
    ["router uppercase", quote({ routerAddress: ROUTER.toUpperCase().replace("0X", "0x").replace(/2/g, "A") })],
    ["router zero", quote({ routerAddress: `0x${"0".repeat(40)}` })],
    ["router short", quote({ routerAddress: "0x1234" })],
    ["required missing", quote({ buyMinimumOutUsdcUnits: MISSING })],
    ["required zero", quote({ buyMinimumOutUsdcUnits: "0" })],
    ["required negative", quote({ buyMinimumOutUsdcUnits: "-1" })],
    ["required decimal", quote({ buyMinimumOutUsdcUnits: "1.5" })],
    ["required leading zero", quote({ buyMinimumOutUsdcUnits: "01" })],
    ["required number", quote({ buyMinimumOutUsdcUnits: 2487500 })],
    ["required over uint256", quote({ buyMinimumOutUsdcUnits: (BigInt(1) << BigInt(256)).toString() })],
  ])("fails closed on invalid quote input without RPC work: %s", async (_label, quoteValue) => {
    const { fetchImpl, result } = observe(replies(), { quoteValue });
    expect((await rejection(result)).code).toBe("BASE_EXECUTION_STATE_INPUT_INVALID");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN])("fails closed on invalid nowMs %s without RPC work", async (nowMs) => {
    const { fetchImpl, result } = observe(replies(), { nowMs });
    expect((await rejection(result)).code).toBe("BASE_EXECUTION_STATE_INPUT_INVALID");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
