import "server-only";

import { z } from "zod";

const BASE_CHAIN_ID = 8453;
const BASE_USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ALLOWANCE_SELECTOR = "0xdd62ed3e"; // allowance(address,address)
const GAS_PRICE_ORACLE_ADDRESS = "0x420000000000000000000000000000000000000f";
// Selectors confirmed against the 4byte directory and a live read of Base mainnet (oracle version 1.6.0).
// isJovian() is not listed in the 4byte directory, so its selector was derived from keccak256("isJovian()")
// and cross-checked against the official GasPriceOracle ABI snapshot and a live read of Base mainnet.
const ORACLE_SELECTORS = {
  l1BaseFee: "0x519b4bd3",
  blobBaseFee: "0xf8206140",
  baseFeeScalar: "0xc5985918",
  blobBaseFeeScalar: "0x68d5dca6",
  isFjord: "0x960e3a23",
  isIsthmus: "0xb54501bc",
  isJovian: "0x105d0b81",
} as const;
const L1_BLOCK_ADDRESS = "0x4200000000000000000000000000000000000015";
// Selectors confirmed against the L1Block ABI snapshot (operatorFeeScalar -> uint32,
// operatorFeeConstant -> uint64) and a live read of Base mainnet (L1Block version 1.7.0).
const L1_BLOCK_SELECTORS = {
  operatorFeeScalar: "0x4d5d9a2a",
  operatorFeeConstant: "0x16d3bc7f",
} as const;
const MAX_BLOCK_AGE_SECONDS = 60;
const MAX_FUTURE_BLOCK_SECONDS = 5;
const MAX_CODE_BYTES = 24_576; // EIP-170 contract code size limit.
const MAX_UINT = (BigInt(1) << BigInt(256)) - BigInt(1);
const MAX_UINT32 = (BigInt(1) << BigInt(32)) - BigInt(1);
const MAX_UINT64 = (BigInt(1) << BigInt(64)) - BigInt(1);
const POSITIVE_UNITS_PATTERN = /^[1-9][0-9]{0,77}$/;
const EIP7702_DELEGATION_PATTERN = /^0xef0100[0-9a-f]{40}$/i;

type FetchLike = typeof fetch;

interface RpcReply {
  id?: unknown;
  result?: unknown;
  error?: unknown;
}

export interface BaseExecutionStateObservationOptions {
  fetchImpl?: FetchLike;
  nowMs?: number;
  environment?: {
    BASE_RPC_URL?: string;
    BASE_WALLET_ADDRESS?: string;
  };
}

export type BaseExecutionStateObservationErrorCode =
  | "BASE_WALLET_CONFIGURATION_MISSING"
  | "BASE_EXECUTION_STATE_INPUT_INVALID"
  | "BASE_RPC_UNAVAILABLE"
  | "BASE_RPC_INVALID_RESPONSE"
  | "BASE_RPC_WRONG_CHAIN"
  | "BASE_RPC_STALE_BLOCK"
  | "BASE_EXECUTION_STATE_UNEXPECTED_CODE";

export class BaseExecutionStateObservationError extends Error {
  constructor(public readonly code: BaseExecutionStateObservationErrorCode) {
    super(code);
    this.name = "BaseExecutionStateObservationError";
  }
}

// Only the quote fields this observation needs. The quote itself is never executed.
const quoteSchema = z.object({
  mode: z.literal("paper"),
  executionLocked: z.literal(true),
  profitabilityVerified: z.literal(false),
  status: z.literal("observed"),
  readiness: z.literal("blocked"),
  chainId: z.literal(BASE_CHAIN_ID),
  routerAddress: z.string().regex(/^0x[0-9a-f]{40}$/).refine((value) => !/^0x0{40}$/.test(value)),
  // The SELL leg's actual USDC input in the current round-trip quote.
  buyMinimumOutUsdcUnits: z.string()
    .refine((value) => POSITIVE_UNITS_PATTERN.test(value) && BigInt(value) <= MAX_UINT),
});

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

// JSON-RPC quantity (chainId, block number, timestamp): no leading zeros.
function quantityBigInt(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

// eth_call ABI uint256 return data: exactly 32 bytes (64 hex digits).
function uint256ReturnData(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) {
    return null;
  }
  return BigInt(value);
}

// eth_call ABI uint32 return data: 32 bytes that fit in uint32.
function uint32ReturnData(value: unknown): bigint | null {
  const parsed = uint256ReturnData(value);
  return parsed !== null && parsed <= MAX_UINT32 ? parsed : null;
}

// eth_call ABI uint64 return data: 32 bytes that fit in uint64.
function uint64ReturnData(value: unknown): bigint | null {
  const parsed = uint256ReturnData(value);
  return parsed !== null && parsed <= MAX_UINT64 ? parsed : null;
}

// eth_call ABI bool return data: 32 bytes that are exactly 0 or 1.
function boolReturnData(value: unknown): boolean | null {
  if (typeof value !== "string") return null;
  if (/^0x0{64}$/i.test(value)) return false;
  if (/^0x0{63}1$/i.test(value)) return true;
  return null;
}

// eth_getCode result: even-length hex data within the EIP-170 size limit.
function codeData(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2 + MAX_CODE_BYTES * 2) return null;
  return /^0x(?:[0-9a-f]{2})*$/i.test(value) ? value : null;
}

function requiredResult(replies: RpcReply[], id: number): unknown {
  const matching = replies.filter((reply) => reply.id === id);
  if (matching.length !== 1 || matching[0].error !== undefined || matching[0].result === undefined) {
    throw new BaseExecutionStateObservationError("BASE_RPC_INVALID_RESPONSE");
  }
  return matching[0].result;
}

function allowanceData(ownerAddress: string, spenderAddress: string): string {
  return `${ALLOWANCE_SELECTOR}${ownerAddress.slice(2).padStart(64, "0")}${spenderAddress.slice(2).padStart(64, "0")}`;
}

function oracleCall(id: number, data: string) {
  return {
    jsonrpc: "2.0",
    id,
    method: "eth_call",
    params: [{ to: GAS_PRICE_ORACLE_ADDRESS, data }, "latest"],
  };
}

function l1BlockCall(id: number, data: string) {
  return {
    jsonrpc: "2.0",
    id,
    method: "eth_call",
    params: [{ to: L1_BLOCK_ADDRESS, data }, "latest"],
  };
}

/**
 * Read-only Smart Account deployment, USDC allowance and Base fee parameter observation.
 * No signature, approval, permit, calldata build, broadcast or funds movement.
 * Fee parameters are reported as observed values only; they do not prove any execution cost.
 */
export async function getBaseExecutionStateObservation(
  quote: unknown,
  options: BaseExecutionStateObservationOptions = {},
) {
  const environment = options.environment ?? process.env;
  const endpoint = environment.BASE_RPC_URL?.trim() ?? "";
  const configuredWallet = environment.BASE_WALLET_ADDRESS?.trim() ?? "";
  if (!validHttpUrl(endpoint) || !validAddress(configuredWallet)) {
    throw new BaseExecutionStateObservationError("BASE_WALLET_CONFIGURATION_MISSING");
  }

  const parsedQuote = quoteSchema.safeParse(quote);
  const nowMs = options.nowMs ?? Date.now();
  if (!parsedQuote.success || !Number.isSafeInteger(nowMs) || nowMs <= 0) {
    throw new BaseExecutionStateObservationError("BASE_EXECUTION_STATE_INPUT_INVALID");
  }

  const walletAddress = configuredWallet.toLowerCase();
  const routerAddress = parsedQuote.data.routerAddress;
  const payload = [
    { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
    { jsonrpc: "2.0", id: 2, method: "eth_getBlockByNumber", params: ["latest", false] },
    { jsonrpc: "2.0", id: 3, method: "eth_getCode", params: [walletAddress, "latest"] },
    {
      jsonrpc: "2.0",
      id: 4,
      method: "eth_call",
      params: [{ to: BASE_USDC_ADDRESS, data: allowanceData(walletAddress, routerAddress) }, "latest"],
    },
    oracleCall(5, ORACLE_SELECTORS.l1BaseFee),
    oracleCall(6, ORACLE_SELECTORS.blobBaseFee),
    oracleCall(7, ORACLE_SELECTORS.baseFeeScalar),
    oracleCall(8, ORACLE_SELECTORS.blobBaseFeeScalar),
    oracleCall(9, ORACLE_SELECTORS.isFjord),
    oracleCall(10, ORACLE_SELECTORS.isIsthmus),
    l1BlockCall(11, L1_BLOCK_SELECTORS.operatorFeeScalar),
    l1BlockCall(12, L1_BLOCK_SELECTORS.operatorFeeConstant),
    oracleCall(13, ORACLE_SELECTORS.isJovian),
  ];

  // One batch POST. No retry, polling, cache or persistence.
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
    throw new BaseExecutionStateObservationError("BASE_RPC_UNAVAILABLE");
  }
  if (!response.ok) throw new BaseExecutionStateObservationError("BASE_RPC_UNAVAILABLE");

  let replies: RpcReply[];
  try {
    const value = await response.json();
    if (!Array.isArray(value)) throw new Error("not a batch");
    replies = value as RpcReply[];
  } catch {
    throw new BaseExecutionStateObservationError("BASE_RPC_INVALID_RESPONSE");
  }

  const chainId = quantityBigInt(requiredResult(replies, 1));
  if (chainId !== BigInt(BASE_CHAIN_ID)) {
    throw new BaseExecutionStateObservationError("BASE_RPC_WRONG_CHAIN");
  }

  const block = requiredResult(replies, 2);
  if (typeof block !== "object" || block === null) {
    throw new BaseExecutionStateObservationError("BASE_RPC_INVALID_RESPONSE");
  }
  const blockRecord = block as Record<string, unknown>;
  const blockNumber = quantityBigInt(blockRecord.number);
  const blockTimestamp = quantityBigInt(blockRecord.timestamp);
  const l2BaseFeePerGas = quantityBigInt(blockRecord.baseFeePerGas);
  const code = codeData(requiredResult(replies, 3));
  const allowance = uint256ReturnData(requiredResult(replies, 4));
  const l1BaseFee = uint256ReturnData(requiredResult(replies, 5));
  const blobBaseFee = uint256ReturnData(requiredResult(replies, 6));
  const baseFeeScalar = uint32ReturnData(requiredResult(replies, 7));
  const blobBaseFeeScalar = uint32ReturnData(requiredResult(replies, 8));
  const fjord = boolReturnData(requiredResult(replies, 9));
  const isthmus = boolReturnData(requiredResult(replies, 10));
  const operatorFeeScalar = uint32ReturnData(requiredResult(replies, 11));
  const operatorFeeConstant = uint64ReturnData(requiredResult(replies, 12));
  const jovian = boolReturnData(requiredResult(replies, 13));
  if (
    blockNumber === null || blockTimestamp === null || l2BaseFeePerGas === null ||
    code === null || allowance === null ||
    l1BaseFee === null || blobBaseFee === null || baseFeeScalar === null || blobBaseFeeScalar === null ||
    fjord === null || isthmus === null || jovian === null ||
    operatorFeeScalar === null || operatorFeeConstant === null
  ) {
    throw new BaseExecutionStateObservationError("BASE_RPC_INVALID_RESPONSE");
  }

  const nowSeconds = BigInt(Math.floor(nowMs / 1_000));
  if (
    blockTimestamp > nowSeconds + BigInt(MAX_FUTURE_BLOCK_SECONDS) ||
    nowSeconds - blockTimestamp > BigInt(MAX_BLOCK_AGE_SECONDS)
  ) {
    throw new BaseExecutionStateObservationError("BASE_RPC_STALE_BLOCK");
  }

  // An EIP-7702 delegated EOA is not a deployed Smart Account.
  if (EIP7702_DELEGATION_PATTERN.test(code)) {
    throw new BaseExecutionStateObservationError("BASE_EXECUTION_STATE_UNEXPECTED_CODE");
  }

  // Compare integer units directly; never via number.
  const sellLegInputUsdcUnits = BigInt(parsedQuote.data.buyMinimumOutUsdcUnits);

  return {
    mode: "paper" as const,
    executionLocked: true as const,
    status: "observed" as const,
    readiness: "blocked" as const,
    chainId: BASE_CHAIN_ID,
    walletAddress,
    routerAddress,
    usdcAddress: BASE_USDC_ADDRESS,
    smartAccountDeployed: code !== "0x",
    usdcAllowanceUnits: allowance.toString(),
    // BUY leg input is native ETH, which has no ERC-20 allowance.
    buyLegAllowanceRequired: false as const,
    sellLegInputUsdcUnits: sellLegInputUsdcUnits.toString(),
    sellLegAllowanceCovered: allowance >= sellLegInputUsdcUnits,
    // Observed fee inputs at this block. They do not prove L1 coverage, gas usage or any total cost.
    feeParameters: {
      oracleAddress: GAS_PRICE_ORACLE_ADDRESS,
      l2BaseFeePerGasWei: l2BaseFeePerGas.toString(),
      l1BaseFeeWei: l1BaseFee.toString(),
      blobBaseFeeWei: blobBaseFee.toString(),
      baseFeeScalar: baseFeeScalar.toString(),
      blobBaseFeeScalar: blobBaseFeeScalar.toString(),
      fjord,
      isthmus,
      jovian,
      // Operator fee inputs, read from the L1Block predeploy. The formula depends on the active fork:
      //   Isthmus (pre-Jovian): operatorFee = gas * operatorFeeScalar / 1e6 + operatorFeeConstant
      //   Jovian and after:     operatorFee = gas * operatorFeeScalar * 100 + operatorFeeConstant
      // The gas amount is unknown here, so no operator fee is computed under either formula.
      operatorFeeScalar: operatorFeeScalar.toString(),
      operatorFeeConstant: operatorFeeConstant.toString(),
    },
    blockNumber: blockNumber.toString(),
    blockTimestampMs: Number(blockTimestamp) * 1_000,
    observedAtMs: nowMs,
    rpcRequests: 1 as const,
  };
}
