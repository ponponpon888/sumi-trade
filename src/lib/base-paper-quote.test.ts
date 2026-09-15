import { describe, expect, it, vi } from "vitest";

import { getBasePaperQuote } from "@/lib/base-paper-quote";

const NOW = Date.UTC(2026, 8, 14, 12);
const ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const AMOUNT = "1000000000000000"; // 500 JPY / 500,000 JPY per ETH

function price() {
  return { ethereum: { jpy: 500_000, usd: 2_500, last_updated_at: NOW / 1_000 - 30 } };
}

function route(buy: boolean) {
  return { code: 0, data: { routeSummary: {
    tokenIn: buy ? ETH : USDC,
    tokenOut: buy ? USDC : ETH,
    amountIn: buy ? AMOUNT : "2487500",
    amountOut: buy ? "2500000" : "995000000000000",
    gasUsd: "0.001",
    timestamp: NOW / 1_000,
  } } };
}

function fixture(payloads: unknown[] = [price(), route(true), route(false)]) {
  const fetcher = vi.fn<typeof fetch>();
  for (const payload of payloads) fetcher.mockResolvedValueOnce(Response.json(payload));
  return { fetcher, dependencies: { fetch: fetcher, now: () => NOW } };
}

describe("read-only Base quote observation", () => {
  it("quotes 500 JPY with actual units and reverse minimum output, but never declares total cost known", async () => {
    const { fetcher, dependencies } = fixture();
    const result = await getBasePaperQuote(500, dependencies);
    expect(result).toMatchObject({
      mode: "paper", executionLocked: true, profitabilityVerified: false,
      readiness: "blocked", status: "observed", requestedYen: 500,
      amountInWei: AMOUNT, buyMinimumOutUsdcUnits: "2487500",
      sellMinimumOutWei: "990025000000000",
      providerSwapGasEstimateYen: { buy: 1, sell: 1 },
      swapShortfallEstimateYen: 5, knownCostEstimateYen: 7,
      totalCostYen: null, reserveSufficient: null,
    });
    expect(result.incompleteChecks).toContain("L1_FEE_COVERAGE_UNVERIFIED");
    expect(fetcher).toHaveBeenCalledTimes(3);
    const sellUrl = new URL(String(fetcher.mock.calls[2][0]));
    expect(sellUrl.pathname).toBe("/base/api/v1/routes");
    expect(sellUrl.searchParams.get("amountIn")).toBe("2487500");
    expect(sellUrl.searchParams.get("excludeRFQSources")).toBe("true");
    for (const [, options] of fetcher.mock.calls) {
      expect(options).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
      expect(options?.body).toBeUndefined();
    }
  });

  it("sizes 1000 yen separately instead of reusing a 500 yen quote", async () => {
    const buy = route(true);
    buy.data.routeSummary.amountIn = "2000000000000000";
    const { dependencies } = fixture([price(), buy, route(false)]);
    expect((await getBasePaperQuote(1000, dependencies)).amountInWei).toBe("2000000000000000");
  });

  it("preserves real source age rather than stamping a retrieved price as new", async () => {
    const { dependencies } = fixture();
    expect((await getBasePaperQuote(500, dependencies)).valuation.valuationAtMs).toBe(NOW - 30_000);
  });

  it.each([0, 499, 1001, 10000, NaN, Infinity])("makes no calls for unsupported amount %s", async (amount) => {
    const { fetcher, dependencies } = fixture();
    await expect(getBasePaperQuote(amount as 500, dependencies)).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([-181, 1])("rejects old/future prices (%s seconds) before fetching routes", async (offset) => {
    const p = price();
    p.ethereum.last_updated_at = NOW / 1000 + offset;
    const { fetcher, dependencies } = fixture([p]);
    await expect(getBasePaperQuote(500, dependencies)).rejects.toMatchObject({ code: "PRICE_STALE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["tokenIn", USDC, "QUOTE_MISMATCH"],
    ["tokenOut", ETH, "QUOTE_MISMATCH"],
    ["amountIn", "2000000000000000", "QUOTE_MISMATCH"],
    ["amountOut", "1", "AMOUNT_TOO_LOW"],
    ["amountOut", "1e18", "BUY_ROUTE_RESPONSE_INVALID"],
    ["amountOut", "0", "BUY_ROUTE_RESPONSE_INVALID"],
    ["amountOut", (BigInt(1) << BigInt(256)).toString(), "BUY_ROUTE_RESPONSE_INVALID"],
    ["gasUsd", "", "BUY_ROUTE_RESPONSE_INVALID"],
    ["gasUsd", "-1", "BUY_ROUTE_RESPONSE_INVALID"],
    ["gasUsd", null, "BUY_ROUTE_RESPONSE_INVALID"],
    ["timestamp", NOW / 1000 - 11, "QUOTE_STALE"],
    ["timestamp", NOW / 1000 + 1, "QUOTE_STALE"],
  ])("fails closed for buy %s=%s", async (key, value, code) => {
    const buy = route(true);
    Object.assign(buy.data.routeSummary, { [String(key)]: value });
    const { fetcher, dependencies } = fixture([price(), buy]);
    await expect(getBasePaperQuote(500, dependencies)).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects a reverse quote for a different token/amount", async () => {
    const sell = route(false);
    sell.data.routeSummary.amountIn = "2500000";
    const { dependencies } = fixture([price(), route(true), sell]);
    await expect(getBasePaperQuote(500, dependencies)).rejects.toMatchObject({ code: "QUOTE_MISMATCH" });
  });

  it.each([
    ["price", [{ ethereum: { jpy: 0, usd: 2_500, last_updated_at: NOW / 1_000 } }], "PRICE_RESPONSE_INVALID"],
    ["buy route", [price(), { code: "unexpected" }], "BUY_ROUTE_RESPONSE_INVALID"],
    ["sell route", [price(), route(true), { code: "unexpected" }], "SELL_ROUTE_RESPONSE_INVALID"],
  ])("reports the invalid provider response stage without exposing provider data (%s)", async (_stage, payloads, code) => {
    const { fetcher, dependencies } = fixture(payloads);
    await expect(getBasePaperQuote(500, dependencies)).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(payloads.length);
  });

  it("rechecks the BUY quote after a slow SELL request", async () => {
    const { dependencies } = fixture();
    const now = vi.fn().mockReturnValueOnce(NOW).mockReturnValueOnce(NOW)
      .mockReturnValueOnce(NOW).mockReturnValue(NOW + 11_000);
    await expect(getBasePaperQuote(500, { ...dependencies, now })).rejects.toMatchObject({ code: "QUOTE_STALE" });
  });

  it.each([429, 500, 401])("does not retry HTTP %s or expose the upstream body", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("private upstream text", { status }));
    await expect(getBasePaperQuote(500, { fetch: fetcher, now: () => NOW })).rejects.toMatchObject({
      code: status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_UNAVAILABLE",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not expose raw network errors", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("sensitive transport details"));
    await expect(getBasePaperQuote(500, { fetch: fetcher, now: () => NOW })).rejects.toMatchObject({
      message: "PROVIDER_UNAVAILABLE",
    });
  });

  it("does not replace missing gas with a zero-cost fallback", async () => {
    const buy = route(true);
    const { gasUsd: _unused, ...missingGas } = buy.data.routeSummary;
    void _unused;
    const { dependencies } = fixture([price(), { code: 0, data: { routeSummary: missingGas } }]);
    await expect(getBasePaperQuote(500, dependencies)).rejects.toMatchObject({ code: "BUY_ROUTE_RESPONSE_INVALID" });
  });
});
