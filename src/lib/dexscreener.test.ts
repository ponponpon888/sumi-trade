import { afterEach, describe, expect, it, vi } from "vitest";

import { getTokenMarketLookups, getTokenMarkets } from "@/lib/dexscreener";

const FOUND = "0x00000000000000000000000000000000000000a1";
const NO_PAIR = "0x00000000000000000000000000000000000000a2";
const LIMITED = "0x00000000000000000000000000000000000000a3";
const TIMED_OUT = "0x00000000000000000000000000000000000000a4";
const MALFORMED = "0x00000000000000000000000000000000000000a5";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function pair(baseAddress: string) {
  return {
    chainId: "ethereum",
    dexId: "uniswap",
    url: "https://example.com/pair",
    pairAddress: "0x00000000000000000000000000000000000000b1",
    baseToken: { address: baseAddress, name: "Test", symbol: "TEST" },
    quoteToken: { address: WETH, name: "Wrapped Ether", symbol: "WETH" },
    priceUsd: "1.5",
    liquidity: { usd: 500_000 },
    volume: { h24: 50_000 },
    priceChange: { h24: 1 },
  };
}

describe("dexscreener market lookups", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("separates a failed request from a response without a trusted pair", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith(FOUND)) return json({ pairs: [pair(FOUND)] });
        if (url.endsWith(NO_PAIR)) return json({ pairs: [] });
        if (url.endsWith(LIMITED)) return json({}, 429);
        if (url.endsWith(TIMED_OUT)) throw new DOMException("timed out", "TimeoutError");
        return json({ pairs: "not-an-array" });
      }),
    );

    const lookups = await getTokenMarketLookups([FOUND, NO_PAIR, LIMITED, TIMED_OUT, MALFORMED]);
    expect(lookups.get(FOUND)).toMatchObject({ status: "found", market: { priceUsd: 1.5 } });
    expect(lookups.get(NO_PAIR)).toEqual({ status: "no-pair" });
    expect(lookups.get(LIMITED)).toEqual({ status: "failed", failureKind: "rate-limited" });
    expect(lookups.get(TIMED_OUT)).toEqual({ status: "failed", failureKind: "timeout" });
    expect(lookups.get(MALFORMED)).toEqual({ status: "failed", failureKind: "parse-error" });
  });

  it("keeps the legacy market map returning null for both failures and missing pairs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) =>
        String(input).endsWith(FOUND) ? json({ pairs: [pair(FOUND)] }) : json({}, 500),
      ),
    );
    const markets = await getTokenMarkets([FOUND, LIMITED]);
    expect(markets.get(FOUND)).toMatchObject({ priceUsd: 1.5 });
    expect(markets.get(LIMITED)).toBeNull();
  });

  it("reads recent buy and sell counts without requiring them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith(FOUND)) {
          return json({
            pairs: [{
              ...pair(FOUND),
              volume: { h1: 3_000, h24: 48_000 },
              txns: { m5: { buys: 1, sells: 0 }, h1: { buys: 30, sells: 10 }, h6: { buys: 90, sells: 110 } },
            }],
          });
        }
        return json({ pairs: [pair(NO_PAIR)] });
      }),
    );

    const lookups = await getTokenMarketLookups([FOUND, NO_PAIR]);
    expect(lookups.get(FOUND)).toMatchObject({
      status: "found",
      market: {
        orderFlow: { buysH1: 30, sellsH1: 10, buysH6: 90, sellsH6: 110, volumeH1Usd: 3_000 },
      },
    });
    expect(lookups.get(NO_PAIR)).toMatchObject({
      status: "found",
      market: {
        orderFlow: { buysH1: null, sellsH1: null, buysH6: null, sellsH6: null, volumeH1Usd: null },
      },
    });
  });
});
