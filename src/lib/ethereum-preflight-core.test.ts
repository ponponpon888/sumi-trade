import { describe, expect, it } from "vitest";

import { assessEthereumState } from "@/lib/ethereum-preflight-core";

const NOW = 1_800_000_000;

describe("Ethereum state preflight", () => {
  it("passes a fresh mainnet block with deployed contract code", () => {
    const result = assessEthereumState({
      rpcConfigured: true,
      chainId: 1,
      blockNumber: 25_000_000,
      blockTimestampSeconds: NOW - 12,
      contractCode: "0x60016000",
    }, NOW);

    expect(result.status).toBe("pass");
    expect(result.readOnly).toBe(true);
    expect(result.blockAgeSeconds).toBe(12);
  });

  it("blocks the wrong chain, stale blocks, and addresses without code", () => {
    const result = assessEthereumState({
      rpcConfigured: true,
      chainId: 11155111,
      blockNumber: 10,
      blockTimestampSeconds: NOW - 181,
      contractCode: "0x",
    }, NOW);

    expect(result.status).toBe("blocked");
    expect(result.reasons).toHaveLength(3);
  });

  it("fails closed when RPC is not configured", () => {
    const result = assessEthereumState({
      rpcConfigured: false,
      chainId: null,
      blockNumber: null,
      blockTimestampSeconds: null,
      contractCode: null,
    }, NOW);

    expect(result.status).toBe("unavailable");
    expect(result.contractCodePresent).toBeNull();
  });
});
