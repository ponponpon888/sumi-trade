import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BaseWalletObservationError,
  getBaseWalletObservation,
} from "@/lib/base-wallet-observation";

const NOW_MS = 1_789_430_700_000;
const WALLET = "0x1111111111111111111111111111111111111111";
const USDC_50_RETURN_DATA = `0x${"2faf080".padStart(64, "0")}`;
const USDC_ZERO_RETURN_DATA = `0x${"0".repeat(64)}`;

function environment(overrides: {
  BASE_RPC_URL?: string;
  BASE_WALLET_ADDRESS?: string;
} = {}) {
  return {
    BASE_RPC_URL: "https://base.example/rpc",
    BASE_WALLET_ADDRESS: WALLET,
    ...overrides,
  };
}

function validReplies() {
  const nowSeconds = Math.floor(NOW_MS / 1_000);
  return [
    { jsonrpc: "2.0", id: 4, result: USDC_50_RETURN_DATA },
    { jsonrpc: "2.0", id: 2, result: { number: "0x1e240", timestamp: `0x${nowSeconds.toString(16)}` } },
    { jsonrpc: "2.0", id: 1, result: "0x2105" },
    { jsonrpc: "2.0", id: 3, result: "0xde0b6b3a7640000" },
  ];
}

function rpcResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("Base wallet observation", () => {
  it("reads Base ETH and USDC balances in one fixed batch request", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      calls.push([input, init]);
      return rpcResponse(validReplies());
    });
    const result = await getBaseWalletObservation({
      fetchImpl,
      nowMs: NOW_MS,
      environment: environment(),
    });

    expect(result).toMatchObject({
      mode: "paper",
      executionLocked: true,
      readiness: "blocked",
      chainId: 8453,
      walletAddress: WALLET,
      nativeBalanceWei: "1000000000000000000",
      usdcBalanceUnits: "50000000",
      rpcRequests: 1,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = calls[0];
    expect(url).toBe("https://base.example/rpc");
    const payload = JSON.parse(String(init?.body));
    expect(payload.map((request: { method: string }) => request.method)).toEqual([
      "eth_chainId",
      "eth_getBlockByNumber",
      "eth_getBalance",
      "eth_call",
    ]);
    expect(payload[3].params[0]).toEqual({
      to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      data: `0x70a08231${WALLET.slice(2).padStart(64, "0")}`,
    });
  });

  it.each([
    [{ BASE_RPC_URL: "" }, "BASE_WALLET_CONFIGURATION_MISSING"],
    [{ BASE_WALLET_ADDRESS: "not-an-address" }, "BASE_WALLET_CONFIGURATION_MISSING"],
    [{ BASE_WALLET_ADDRESS: "0x0000000000000000000000000000000000000000" }, "BASE_WALLET_CONFIGURATION_MISSING"],
  ] as const)("fails closed for invalid configuration %j", async (overrides, code) => {
    const fetchImpl = vi.fn();
    await expect(getBaseWalletObservation({
      fetchImpl,
      nowMs: NOW_MS,
      environment: environment(overrides),
    })).rejects.toMatchObject({ code });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an RPC endpoint that is not Base", async () => {
    const replies = validReplies();
    replies.find((reply) => reply.id === 1)!.result = "0x1";
    await expect(getBaseWalletObservation({
      fetchImpl: vi.fn(async () => rpcResponse(replies)),
      nowMs: NOW_MS,
      environment: environment(),
    })).rejects.toMatchObject({ code: "BASE_RPC_WRONG_CHAIN" });
  });

  it("rejects stale block data", async () => {
    const replies = validReplies();
    const block = replies.find((reply) => reply.id === 2)!.result as Record<string, string>;
    block.timestamp = `0x${(Math.floor(NOW_MS / 1_000) - 61).toString(16)}`;
    await expect(getBaseWalletObservation({
      fetchImpl: vi.fn(async () => rpcResponse(replies)),
      nowMs: NOW_MS,
      environment: environment(),
    })).rejects.toMatchObject({ code: "BASE_RPC_STALE_BLOCK" });
  });

  it.each([
    [USDC_ZERO_RETURN_DATA, "0"],
    [USDC_50_RETURN_DATA, "50000000"],
  ])("accepts 32-byte ABI uint256 USDC balanceOf return data %s", async (returnData, units) => {
    const replies = validReplies().map((reply) => reply.id === 4 ? { ...reply, result: returnData } : reply);
    const fetchImpl = vi.fn(async () => rpcResponse(replies));
    const result = await getBaseWalletObservation({
      fetchImpl,
      nowMs: NOW_MS,
      environment: environment(),
    });
    expect(result).toMatchObject({
      mode: "paper",
      executionLocked: true,
      readiness: "blocked",
      usdcBalanceUnits: units,
      rpcRequests: 1,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["31 bytes", `0x${"0".repeat(62)}`],
    ["33 bytes", `0x${"0".repeat(66)}`],
    ["non-hex digit", `0x${"0".repeat(63)}g`],
    ["quantity zero", "0x0"],
    ["quantity without padding", "0x2faf080"],
    ["missing 0x prefix", "0".repeat(64)],
  ])("rejects USDC balanceOf return data that is not a 32-byte uint256 (%s)", async (_label, returnData) => {
    const replies = validReplies().map((reply) => reply.id === 4 ? { ...reply, result: returnData } : reply);
    const fetchImpl = vi.fn(async () => rpcResponse(replies));
    await expect(getBaseWalletObservation({
      fetchImpl,
      nowMs: NOW_MS,
      environment: environment(),
    })).rejects.toMatchObject({ code: "BASE_RPC_INVALID_RESPONSE" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    [[...validReplies(), { jsonrpc: "2.0", id: 3, result: "0x1" }]],
    [validReplies().filter((reply) => reply.id !== 4)],
    [validReplies().map((reply) => reply.id === 3 ? { ...reply, result: "12" } : reply)],
    [validReplies().map((reply) => reply.id === 4 ? { jsonrpc: "2.0", id: 4, error: { code: -1 } } : reply)],
  ])("rejects incomplete or ambiguous RPC responses", async (replies) => {
    await expect(getBaseWalletObservation({
      fetchImpl: vi.fn(async () => rpcResponse(replies)),
      nowMs: NOW_MS,
      environment: environment(),
    })).rejects.toBeInstanceOf(BaseWalletObservationError);
  });

  it("sanitizes transport failures into a stable error code", async () => {
    await expect(getBaseWalletObservation({
      fetchImpl: vi.fn(async () => { throw new Error("private upstream details"); }),
      nowMs: NOW_MS,
      environment: environment(),
    })).rejects.toMatchObject({ code: "BASE_RPC_UNAVAILABLE" });
  });
});
