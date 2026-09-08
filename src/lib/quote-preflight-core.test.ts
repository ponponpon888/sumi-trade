import { describe, expect, it } from "vitest";

import {
  assessQuotePreflight,
  type RawPreflightRoute,
  unavailableQuotePreflight,
} from "@/lib/quote-preflight-core";

function route(overrides: Partial<RawPreflightRoute> = {}): RawPreflightRoute {
  return {
    amountIn: "10000000000000000",
    amountOut: "1000000",
    amountInUsd: 50,
    amountOutUsd: 49.5,
    gasUsd: 1.25,
    exchanges: ["uniswap-v3", "uniswap-v3"],
    quotedAt: "2026-09-08T12:00:00.000Z",
    ...overrides,
  };
}

describe("quote preflight assessment", () => {
  it("passes only when both routes exist and round-trip loss is within the limit", () => {
    const result = assessQuotePreflight(
      50,
      route(),
      route({
        amountIn: "1000000",
        amountOut: "9800000000000000",
        amountInUsd: 49.5,
        amountOutUsd: 48.5,
        exchanges: ["uniswap-v3", "sushiswap"],
      }),
      5,
    );

    expect(result).toMatchObject({
      status: "pass",
      roundTripRetentionPercent: 97,
      roundTripLossPercent: 3,
      quoteTtlSeconds: 30,
    });
    expect(result.buy?.exchanges).toEqual(["uniswap-v3"]);
    expect(result.sell?.hopCount).toBe(2);
  });

  it("blocks when no buy route exists", () => {
    const result = assessQuotePreflight(50, null, null);
    expect(result.status).toBe("blocked");
    expect(result.reasons).toContain("ETH→トークンの見積ルートなし");
  });

  it("blocks when the token cannot be quoted back to ETH", () => {
    const result = assessQuotePreflight(50, route(), null);
    expect(result.status).toBe("blocked");
    expect(result.reasons).toContain("トークン→ETHの売却見積ルートなし");
  });

  it("blocks excessive round-trip loss", () => {
    const result = assessQuotePreflight(
      50,
      route(),
      route({ amountInUsd: 45, amountOutUsd: 44 }),
      5,
    );
    expect(result.status).toBe("blocked");
    expect(result.roundTripLossPercent).toBe(12);
    expect(result.reasons[0]).toContain("上限5%超");
  });

  it("blocks malformed or zero-valued routes", () => {
    const result = assessQuotePreflight(
      50,
      route({ amountOut: "0", amountOutUsd: 0 }),
      route(),
    );
    expect(result.status).toBe("blocked");
    expect(result.reasons[0]).toContain("見積値が不正");
  });

  it("fails closed when the quote provider is unavailable", () => {
    const result = unavailableQuotePreflight(50, "timeout");
    expect(result).toMatchObject({
      status: "unavailable",
      buy: null,
      sell: null,
      reasons: ["timeout"],
    });
  });
});
