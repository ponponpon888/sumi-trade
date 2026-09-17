import { describe, expect, it } from "vitest";

import { classifyMarket, marketSourceCheck } from "@/lib/portfolio";
import type { MarketData } from "@/lib/types";

function market(overrides: Partial<MarketData> = {}): MarketData {
  return {
    dexId: "uniswap",
    pairAddress: "0xpair",
    pairUrl: "https://example.com/pair",
    priceUsd: 0.1,
    liquidityUsd: 500_000,
    volume24hUsd: 50_000,
    priceChange24h: 1,
    ...overrides,
  };
}

describe("classifyMarket", () => {
  it("allows liquid markets", () => {
    expect(classifyMarket(market()).tradability).toBe("eligible");
  });

  it("requires a firm quote for thin markets", () => {
    expect(
      classifyMarket(market({ liquidityUsd: 45_000, volume24hUsd: 2_000 }))
        .tradability,
    ).toBe("thin");
  });

  it("blocks markets with almost no daily volume", () => {
    expect(
      classifyMarket(market({ liquidityUsd: 82_000, volume24hUsd: 1.25 }))
        .tradability,
    ).toBe("blocked");
  });

  it("blocks missing market routes", () => {
    expect(classifyMarket(null).tradability).toBe("blocked");
  });
});

describe("marketSourceCheck", () => {
  it("separates a failed Dexscreener request from a response without a usable pair", () => {
    expect(marketSourceCheck({ status: "found", market: market() })).toEqual({ outcome: "success" });
    expect(marketSourceCheck({ status: "no-pair" })).toEqual({ outcome: "policy-blocked" });
    expect(marketSourceCheck({ status: "found", market: market({ priceUsd: null }) })).toEqual({
      outcome: "policy-blocked",
    });
    expect(marketSourceCheck({ status: "failed", failureKind: "rate-limited" })).toEqual({
      outcome: "source-unavailable",
      failureKind: "rate-limited",
    });
    expect(marketSourceCheck(undefined)).toEqual({
      outcome: "source-unavailable",
      failureKind: "other",
    });
  });
});
