import "server-only";

const BASE_CHAIN_ID = 8453;
const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const MAX_BLOCK_AGE_SECONDS = 60;
const MAX_FUTURE_BLOCK_SECONDS = 5;

type FetchLike = typeof fetch;

interface RpcReply {
  id?: unknown;
  result?: unknown;
  error?: unknown;
}

interface ObservationOptions {
  fetchImpl?: FetchLike;
  nowMs?: number;
  environment?: {
    BASE_RPC_URL?: string;
    BASE_WALLET_ADDRESS?: string;
  };
}

export type BaseWalletObservationErrorCode =
  | "BASE_WALLET_CONFIGURATION_MISSING"
  | "BASE_RPC_UNAVAILABLE"
  | "BASE_RPC_INVALID_RESPONSE"
  | "BASE_RPC_WRONG_CHAIN"
  | "BASE_RPC_STALE_BLOCK";

export class BaseWalletObservationError extends Error {
  constructor(public readonly code: BaseWalletObservationErrorCode) {
    super(code);
    this.name = "BaseWalletObservationError";
  }
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function validAddress(value: string): boolean {
  return /^0x[0-9a-f]{40}$/i.test(value) && !/^0x0{40}$/i.test(value);
}

function hexBigInt(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function requiredResult(replies: RpcReply[], id: number): unknown {
  const matching = replies.filter((reply) => reply.id === id);
  if (matching.length !== 1 || matching[0].error !== undefined || matching[0].result === undefined) {
    throw new BaseWalletObservationError("BASE_RPC_INVALID_RESPONSE");
  }
  return matching[0].result;
}

function balanceOfData(walletAddress: string): string {
  return `0x70a08231${walletAddress.slice(2).toLowerCase().padStart(64, "0")}`;
}

export async function getBaseWalletObservation(options: ObservationOptions = {}) {
  const environment = options.environment ?? process.env;
  const endpoint = environment.BASE_RPC_URL?.trim() ?? "";
  const walletAddress = environment.BASE_WALLET_ADDRESS?.trim() ?? "";
  if (!validHttpUrl(endpoint) || !validAddress(walletAddress)) {
    throw new BaseWalletObservationError("BASE_WALLET_CONFIGURATION_MISSING");
  }

  const nowMs = options.nowMs ?? Date.now();
  const payload = [
    { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
    { jsonrpc: "2.0", id: 2, method: "eth_getBlockByNumber", params: ["latest", false] },
    { jsonrpc: "2.0", id: 3, method: "eth_getBalance", params: [walletAddress, "latest"] },
    {
      jsonrpc: "2.0",
      id: 4,
      method: "eth_call",
      params: [{ to: BASE_USDC_ADDRESS, data: balanceOfData(walletAddress) }, "latest"],
    },
  ];

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new BaseWalletObservationError("BASE_RPC_UNAVAILABLE");
  }
  if (!response.ok) throw new BaseWalletObservationError("BASE_RPC_UNAVAILABLE");

  let replies: RpcReply[];
  try {
    const value = await response.json();
    if (!Array.isArray(value)) throw new Error("not a batch");
    replies = value as RpcReply[];
  } catch {
    throw new BaseWalletObservationError("BASE_RPC_INVALID_RESPONSE");
  }

  const chainId = hexBigInt(requiredResult(replies, 1));
  if (chainId !== BigInt(BASE_CHAIN_ID)) {
    throw new BaseWalletObservationError("BASE_RPC_WRONG_CHAIN");
  }

  const block = requiredResult(replies, 2);
  if (typeof block !== "object" || block === null) {
    throw new BaseWalletObservationError("BASE_RPC_INVALID_RESPONSE");
  }
  const blockRecord = block as Record<string, unknown>;
  const blockNumber = hexBigInt(blockRecord.number);
  const blockTimestamp = hexBigInt(blockRecord.timestamp);
  const nativeBalance = hexBigInt(requiredResult(replies, 3));
  const usdcBalance = hexBigInt(requiredResult(replies, 4));
  if (blockNumber === null || blockTimestamp === null || nativeBalance === null || usdcBalance === null) {
    throw new BaseWalletObservationError("BASE_RPC_INVALID_RESPONSE");
  }

  const nowSeconds = BigInt(Math.floor(nowMs / 1_000));
  if (
    blockTimestamp > nowSeconds + BigInt(MAX_FUTURE_BLOCK_SECONDS) ||
    nowSeconds - blockTimestamp > BigInt(MAX_BLOCK_AGE_SECONDS)
  ) {
    throw new BaseWalletObservationError("BASE_RPC_STALE_BLOCK");
  }

  return {
    mode: "paper" as const,
    executionLocked: true as const,
    status: "observed" as const,
    readiness: "blocked" as const,
    chainId: BASE_CHAIN_ID,
    walletAddress: walletAddress.toLowerCase(),
    nativeBalanceWei: nativeBalance.toString(),
    usdcBalanceUnits: usdcBalance.toString(),
    usdcDecimals: 6,
    blockNumber: blockNumber.toString(),
    blockTimestampMs: Number(blockTimestamp) * 1_000,
    observedAtMs: nowMs,
    rpcRequests: 1,
    incompleteChecks: [
      "L1_FEE_COVERAGE_UNVERIFIED",
      "TOKEN_APPROVAL_COST_UNVERIFIED",
      "SIGNER_FEES_UNVERIFIED",
      "EXECUTION_VALUATION_UNVERIFIED",
    ] as const,
  };
}
