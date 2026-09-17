import "server-only";

import {
  classifyDataSourceFailure,
  DataSourceHttpError,
  DataSourceParseError,
} from "@/lib/data-source-failure";
import { assessEthereumState } from "@/lib/ethereum-preflight-core";
import type {
  DataSourceFailureKind,
  OnchainPreflightAssessment,
} from "@/lib/types";

function withFailureKind(
  assessment: OnchainPreflightAssessment,
  failureKind: DataSourceFailureKind,
): OnchainPreflightAssessment {
  return assessment.status === "unavailable" ? { ...assessment, failureKind } : assessment;
}

interface RpcResponse {
  id?: number;
  result?: unknown;
}

function hexQuantity(value: unknown): number | null {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return null;
  const parsed = Number.parseInt(value.slice(2), 16);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function getOnchainPreflightAssessments(
  addresses: string[],
): Promise<Map<string, OnchainPreflightAssessment>> {
  const unique = [...new Set(addresses.map((address) => address.toLowerCase()))];
  const endpoint = process.env.ETHEREUM_RPC_URL?.trim();
  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (!endpoint) {
    return new Map(
      unique.map((address) => [
        address,
        withFailureKind(
          assessEthereumState(
            {
              rpcConfigured: false,
              chainId: null,
              blockNumber: null,
              blockTimestampSeconds: null,
              contractCode: null,
            },
            nowSeconds,
          ),
          "other",
        ),
      ]),
    );
  }

  try {
    const payload = [
      { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
      { jsonrpc: "2.0", id: 2, method: "eth_getBlockByNumber", params: ["latest", false] },
      ...unique.map((address, index) => ({
        jsonrpc: "2.0",
        id: 100 + index,
        method: "eth_getCode",
        params: [address, "latest"],
      })),
    ];
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new DataSourceHttpError(response.status, `Ethereum RPC ${response.status}`);
    }
    const replies = (await response.json()) as RpcResponse[];
    if (!Array.isArray(replies)) {
      throw new DataSourceParseError("Ethereum RPC batch response missing");
    }
    const byId = new Map(replies.map((reply) => [reply.id, reply.result]));
    const chainId = hexQuantity(byId.get(1));
    const block = byId.get(2);
    const blockRecord =
      typeof block === "object" && block !== null
        ? (block as Record<string, unknown>)
        : null;
    const blockNumber = hexQuantity(blockRecord?.number);
    const blockTimestampSeconds = hexQuantity(blockRecord?.timestamp);

    return new Map(
      unique.map((address, index) => [
        address,
        // An OK response with missing fields is an incomplete (unparseable) reply.
        withFailureKind(
          assessEthereumState(
            {
              rpcConfigured: true,
              chainId,
              blockNumber,
              blockTimestampSeconds,
              contractCode:
                typeof byId.get(100 + index) === "string"
                  ? (byId.get(100 + index) as string)
                  : null,
            },
            nowSeconds,
          ),
          "parse-error",
        ),
      ]),
    );
  } catch (error) {
    const failureKind = classifyDataSourceFailure(error);
    return new Map(
      unique.map((address) => [
        address,
        withFailureKind(
          assessEthereumState(
            {
              rpcConfigured: true,
              chainId: null,
              blockNumber: null,
              blockTimestampSeconds: null,
              contractCode: null,
            },
            nowSeconds,
          ),
          failureKind,
        ),
      ]),
    );
  }
}
