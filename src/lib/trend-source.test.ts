import { describe, expect, it } from "vitest";

import { parseEthereumTrendingPools } from "@/lib/trend-source-core";

describe("GeckoTerminal trend response", () => {
  it("maps an Ethereum pool and its included base token", () => {
    const result = parseEthereumTrendingPools({
      data: [{
        id: "eth_0x2222222222222222222222222222222222222222",
        type: "pool",
        attributes: {
          base_token_price_usd: "1.25",
          address: "0x2222222222222222222222222222222222222222",
          name: "TREND / WETH",
          pool_created_at: "2026-01-01T00:00:00Z",
          price_change_percentage: { h1: "2", h6: "8", h24: "15" },
          transactions: {
            h24: { buys: 120, sells: 80, buyers: 100, sellers: 70 },
          },
          volume_usd: { h24: "1000000" },
          reserve_in_usd: "2000000",
          sentiment_vote_positive_percentage: 75,
          sentiment_vote_negative_percentage: 25,
          community_sus_report: 0,
        },
        relationships: {
          base_token: { data: { id: "eth_0x1111111111111111111111111111111111111111", type: "token" } },
          quote_token: { data: { id: "eth_0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", type: "token" } },
        },
      }],
      included: [{
        id: "eth_0x1111111111111111111111111111111111111111",
        type: "token",
        attributes: {
          address: "0x1111111111111111111111111111111111111111",
          name: "Trend Token",
          symbol: "trend",
        },
      }],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      symbol: "TREND",
      priceUsd: 1.25,
      liquidityUsd: 2_000_000,
      volume24hUsd: 1_000_000,
      buyers24h: 100,
      sellers24h: 70,
    });
  });
});
