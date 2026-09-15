import { describe, expect, it, vi } from "vitest";

import { getBasePaperQuote } from "@/lib/base-paper-quote";

const NOW = Date.UTC(2026, 8, 14, 12);
const ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const AMOUNT = "1000000000000000"; // 500 JPY / 500,000 JPY per ETH
const ROUTER = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01"; // Test fixture, not a pinned router.
const MISSING = Symbol("missing");
// Observed in live KyberSwap Base responses (21 decimal places).
const BUY_L1_FEE_USD = "0.000010504194855782713";
const SELL_L1_FEE_USD = "0.000010505958804660843";

function price() {
  return { ethereum: { jpy: 500_000, usd: 2_500, last_updated_at: NOW / 1_000 - 30 } };
}

function route(buy: boolean) {
  return { code: 0, data: { routerAddress: ROUTER, routeSummary: {
    tokenIn: buy ? ETH : USDC,
    tokenOut: buy ? USDC : ETH,
    amountIn: buy ? AMOUNT : "2487500",
    amountOut: buy ? "2500000" : "995000000000000",
    gas: buy ? "250000" : "300000",
    gasPrice: "5000000",
    gasUsd: "0.001",
    l1FeeUsd: buy ? BUY_L1_FEE_USD : SELL_L1_FEE_USD,
    timestamp: NOW / 1_000,
  } } };
}

function withField(
  payload: ReturnType<typeof route>,
  target: "data" | "routeSummary",
  key: string,
  value: unknown,
) {
  const record = (target === "data" ? payload.data : payload.data.routeSummary) as Record<string, unknown>;
  if (value === MISSING) delete record[key];
  else record[key] = value;
  return payload;
}

const INVALID_ROUTE_FIELDS: Array<[string, "data" | "routeSummary", string, unknown]> = [
  ["routerAddress missing", "data", "routerAddress", MISSING],
  ["routerAddress null", "data", "routerAddress", null],
  ["routerAddress short", "data", "routerAddress", "0x1234"],
  ["routerAddress too long", "data", "routerAddress", `0x${"a".repeat(42)}`],
  ["routerAddress non-hex", "data", "routerAddress", `0x${"g".repeat(40)}`],
  ["routerAddress without 0x", "data", "routerAddress", "a".repeat(40)],
  ["routerAddress zero", "data", "routerAddress", `0x${"0".repeat(40)}`],
  ["routerAddress number", "data", "routerAddress", 1],
  ["gas missing", "routeSummary", "gas", MISSING],
  ["gas null", "routeSummary", "gas", null],
  ["gas empty", "routeSummary", "gas", ""],
  ["gas zero", "routeSummary", "gas", "0"],
  ["gas decimal", "routeSummary", "gas", "1.5"],
  ["gas exponent", "routeSummary", "gas", "1e5"],
  ["gas negative", "routeSummary", "gas", "-1"],
  ["gas leading zero", "routeSummary", "gas", "0250000"],
  ["gas number", "routeSummary", "gas", 250000],
  ["gas over uint256", "routeSummary", "gas", (BigInt(1) << BigInt(256)).toString()],
  ["gasPrice missing", "routeSummary", "gasPrice", MISSING],
  ["gasPrice decimal", "routeSummary", "gasPrice", "0.5"],
  ["gasPrice hex", "routeSummary", "gasPrice", "0x4c4b40"],
  ["gasPrice number", "routeSummary", "gasPrice", 5000000],
  ["l1FeeUsd empty", "routeSummary", "l1FeeUsd", ""],
  ["l1FeeUsd negative", "routeSummary", "l1FeeUsd", "-0.1"],
  ["l1FeeUsd exponent", "routeSummary", "l1FeeUsd", "1e-4"],
  ["l1FeeUsd number", "routeSummary", "l1FeeUsd", 0.0002],
  ["l1FeeUsd text", "routeSummary", "l1FeeUsd", "abc"],
  ["l1FeeUsd object", "routeSummary", "l1FeeUsd", {}],
  ["l1FeeUsd NaN", "routeSummary", "l1FeeUsd", "NaN"],
  ["l1FeeUsd Infinity", "routeSummary", "l1FeeUsd", "Infinity"],
  ["l1FeeUsd leading zero", "routeSummary", "l1FeeUsd", "00.1"],
  ["l1FeeUsd leading zero integer", "routeSummary", "l1FeeUsd", "01"],
  ["l1FeeUsd trailing dot", "routeSummary", "l1FeeUsd", "1."],
  ["l1FeeUsd leading dot", "routeSummary", "l1FeeUsd", ".5"],
  ["l1FeeUsd 19-digit integer", "routeSummary", "l1FeeUsd", "1".repeat(19)],
  ["l1FeeUsd 37 decimals", "routeSummary", "l1FeeUsd", `0.${"1".repeat(37)}`],
];

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
    const { dependencies } = fixture([price(), { code: 0, data: { routerAddress: ROUTER, routeSummary: missingGas } }]);
    await expect(getBasePaperQuote(500, dependencies)).rejects.toMatchObject({ code: "BUY_ROUTE_RESPONSE_INVALID" });
  });

  it("reports the provider router and per-leg estimates without changing existing values", async () => {
    const { fetcher, dependencies } = fixture();
    const result = await getBasePaperQuote(500, dependencies);
    expect(result).toMatchObject({
      routerAddress: ROUTER.toLowerCase(),
      buyAmountOutUsdcUnits: "2500000",
      buyMinimumOutUsdcUnits: "2487500",
      sellMinimumOutWei: "990025000000000",
      knownCostEstimateYen: 7,
      totalCostYen: null,
      reserveSufficient: null,
      executionLocked: true,
      profitabilityVerified: false,
    });
    expect(result.providerEstimate).toEqual({
      buy: { gas: "250000", gasPriceWei: "5000000", gasUsd: "0.001", l1FeeUsd: BUY_L1_FEE_USD },
      sell: { gas: "300000", gasPriceWei: "5000000", gasUsd: "0.001", l1FeeUsd: SELL_L1_FEE_USD },
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("reports buyAmountOutUsdcUnits before slippage and keeps the minimum unchanged", async () => {
    const buy = route(true);
    buy.data.routeSummary.amountOut = "2500001";
    const sell = route(false);
    sell.data.routeSummary.amountIn = "2487500"; // floor(2500001 * 9950 / 10000)
    const { dependencies } = fixture([price(), buy, sell]);
    const result = await getBasePaperQuote(500, dependencies);
    expect(result.buyAmountOutUsdcUnits).toBe("2500001");
    expect(result.buyMinimumOutUsdcUnits).toBe("2487500");
  });

  it("keeps provider integers and decimals as exact strings beyond number precision", async () => {
    const buy = route(true);
    Object.assign(buy.data.routeSummary, {
      gas: "123456789012345678901234567890",
      gasPrice: "900719925474099312345",
      gasUsd: "0.001000000000000001",
      l1FeeUsd: "0.123456789012345678",
    });
    const { dependencies } = fixture([price(), buy, route(false)]);
    const estimate = (await getBasePaperQuote(500, dependencies)).providerEstimate.buy;
    expect(estimate).toEqual({
      gas: "123456789012345678901234567890",
      gasPriceWei: "900719925474099312345",
      gasUsd: "0.001000000000000001",
      l1FeeUsd: "0.123456789012345678",
    });
    for (const value of Object.values(estimate)) expect(typeof value).toBe("string");
  });

  it.each([
    ["live buy value", BUY_L1_FEE_USD],
    ["live sell value", SELL_L1_FEE_USD],
    ["36 decimals", `0.${"1".repeat(36)}`],
    ["18-digit integer with 36 decimals", `${"9".repeat(18)}.${"9".repeat(36)}`],
    ["zero", "0"],
  ])("accepts l1FeeUsd %s on both legs as an unchanged string", async (_label, value) => {
    const buy = withField(route(true), "routeSummary", "l1FeeUsd", value);
    const sell = withField(route(false), "routeSummary", "l1FeeUsd", value);
    const { fetcher, dependencies } = fixture([price(), buy, sell]);
    const result = await getBasePaperQuote(500, dependencies);
    expect(result.providerEstimate.buy.l1FeeUsd).toBe(value);
    expect(result.providerEstimate.sell.l1FeeUsd).toBe(value);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("accepts buy and sell router addresses that match case-insensitively", async () => {
    const sell = route(false);
    sell.data.routerAddress = ROUTER.toLowerCase();
    const { dependencies } = fixture([price(), route(true), sell]);
    expect((await getBasePaperQuote(500, dependencies)).routerAddress).toBe(ROUTER.toLowerCase());
  });

  it("fails closed when buy and sell routes name different routers", async () => {
    const sell = route(false);
    sell.data.routerAddress = "0x2222222222222222222222222222222222222222";
    const { fetcher, dependencies } = fixture([price(), route(true), sell]);
    await expect(getBasePaperQuote(500, dependencies)).rejects.toMatchObject({ code: "QUOTE_MISMATCH" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["buy", "missing", MISSING],
    ["buy", "null", null],
    ["sell", "missing", MISSING],
    ["sell", "null", null],
  ] as const)("reports %s l1FeeUsd as null when %s", async (leg, _label, value) => {
    const buy = route(true);
    const sell = route(false);
    withField(leg === "buy" ? buy : sell, "routeSummary", "l1FeeUsd", value);
    const { dependencies } = fixture([price(), buy, sell]);
    const result = await getBasePaperQuote(500, dependencies);
    expect(result.providerEstimate[leg].l1FeeUsd).toBeNull();
    expect(result.providerEstimate[leg === "buy" ? "sell" : "buy"].l1FeeUsd).not.toBeNull();
  });

  it.each(INVALID_ROUTE_FIELDS)("rejects buy route with %s", async (_label, target, key, value) => {
    const { fetcher, dependencies } = fixture([price(), withField(route(true), target, key, value)]);
    await expect(getBasePaperQuote(500, dependencies)).rejects.toMatchObject({ code: "BUY_ROUTE_RESPONSE_INVALID" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(INVALID_ROUTE_FIELDS)("rejects sell route with %s", async (_label, target, key, value) => {
    const { fetcher, dependencies } = fixture([price(), route(true), withField(route(false), target, key, value)]);
    await expect(getBasePaperQuote(500, dependencies)).rejects.toMatchObject({ code: "SELL_ROUTE_RESPONSE_INVALID" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("stays within three GET requests and never calls a build endpoint", async () => {
    const { fetcher, dependencies } = fixture();
    await getBasePaperQuote(500, dependencies);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map(([url]) => {
      const parsed = new URL(String(url));
      return `${parsed.host}${parsed.pathname}`;
    })).toEqual([
      "api.coingecko.com/api/v3/simple/price",
      "aggregator-api.kyberswap.com/base/api/v1/routes",
      "aggregator-api.kyberswap.com/base/api/v1/routes",
    ]);
    for (const [, options] of fetcher.mock.calls) {
      expect(options).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
      expect(options?.body).toBeUndefined();
    }
  });
});
