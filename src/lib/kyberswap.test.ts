import { afterEach, describe, expect, it, vi } from "vitest";

import { getQuotePreflightAssessments } from "@/lib/kyberswap";

const TOKEN = "0x00000000000000000000000000000000000000d1";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * 本番のKyberSwap Aggregator APIが実際に返す形に合わせたルート応答。
 * timestampはUNIX秒の「数値」で返る（2026-09-19に実APIで確認）。
 */
function routeResponse(
  amountIn: string,
  amountOut: string,
  amountInUsd: string | number,
  amountOutUsd: string | number,
  timestamp: string | number = 1789778672,
) {
  return {
    code: 0,
    message: "successfully",
    data: {
      routeSummary: {
        tokenIn: WETH,
        amountIn,
        amountInUsd,
        tokenOut: TOKEN,
        amountOut,
        amountOutUsd,
        gas: "364658",
        gasPrice: "61919828",
        gasUsd: "0.059142735987560466",
        l1FeeUsd: "0",
        timestamp,
        route: [[{ pool: WETH, exchange: "uniswapv3" }]],
        routeID: "4d6eabe7HGVKXoZn",
        checksum: "10880432268776874506",
      },
      routerAddress: "0x00000000000000000000000000000000000000d2",
    },
    requestId: "4d6eabe7-1c65-4a5e-8667-7d5d80687d6c",
  };
}

function stubRoundTrip(timestamp: string | number = 1789778672) {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      json(routeResponse("20000000000000000", "52381044", "50.00", "49.85", timestamp)),
    )
    .mockResolvedValueOnce(
      json(routeResponse("52381044", "19850000000000000", "49.85", "49.60", timestamp)),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("KyberSwap round-trip quotes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts the real response shape and passes the round-trip gate", async () => {
    stubRoundTrip();
    const result = (await getQuotePreflightAssessments([TOKEN], 2_500)).get(TOKEN);
    expect(result?.status).toBe("pass");
    expect(result?.buy?.exchanges).toEqual(["uniswapv3"]);
    expect(result?.roundTripLossPercent).toBeCloseTo(0.8, 2);
  });

  it("normalizes a numeric UNIX-second timestamp into an ISO quotedAt", async () => {
    stubRoundTrip(1789778672);
    const result = (await getQuotePreflightAssessments([TOKEN], 2_500)).get(TOKEN);
    expect(result?.buy?.quotedAt).toBe("2026-09-19T00:44:32.000Z");
  });

  it("still accepts a string timestamp", async () => {
    stubRoundTrip("1789778672");
    const result = (await getQuotePreflightAssessments([TOKEN], 2_500)).get(TOKEN);
    expect(result?.status).toBe("pass");
    expect(result?.buy?.quotedAt).toBe("2026-09-19T00:44:32.000Z");
  });

  it("accepts numeric USD fields", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json(routeResponse("20000000000000000", "52381044", 50, 49.85)),
      )
      .mockResolvedValueOnce(
        json(routeResponse("52381044", "19850000000000000", 49.85, 49.6)),
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = (await getQuotePreflightAssessments([TOKEN], 2_500)).get(TOKEN);
    expect(result?.status).toBe("pass");
    expect(result?.buy?.amountInUsd).toBe(50);
  });
});

describe("KyberSwap quote failure kinds", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["rate-limited", async () => json({}, 429)],
    ["http-error", async () => json({}, 503)],
    ["parse-error", async () => json({ code: 0, data: {} })],
    ["timeout", async () => {
      throw new DOMException("timed out", "TimeoutError");
    }],
  ] as const)("records %s as an unavailable quote", async (failureKind, response) => {
    vi.stubGlobal("fetch", vi.fn(response));
    const result = (await getQuotePreflightAssessments([TOKEN], 2_500)).get(TOKEN);
    expect(result).toMatchObject({ status: "unavailable", failureKind });
  });

  it("keeps a missing route as a policy block without a failure kind", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "route not found" }, 404)));
    const result = (await getQuotePreflightAssessments([TOKEN], 2_500)).get(TOKEN);
    expect(result?.status).toBe("blocked");
    expect(result).not.toHaveProperty("failureKind");
  });
});
