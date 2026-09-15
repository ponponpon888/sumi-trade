import { describe, expect, it } from "vitest";

import {
  evaluateSmallCapitalPaper,
  SMALL_CAPITAL_POLICY,
  type SmallCapitalPaperInput,
  type SmallCapitalQuote,
} from "@/lib/small-capital-paper";

const NOW = Date.UTC(2026, 8, 14, 12);
const WALLET = "0x1111111111111111111111111111111111111111";
const INPUT = "0x2222222222222222222222222222222222222222";
const OUTPUT = "0x3333333333333333333333333333333333333333";

function quote(overrides: Partial<SmallCapitalQuote> = {}): SmallCapitalQuote {
  return {
    chainId: 8453,
    walletAddress: WALLET,
    recipientAddress: WALLET,
    inputToken: INPUT,
    outputToken: OUTPUT,
    amountInYen: 500,
    buyMinimumOutUnits: "1000000000000000000",
    sellAmountInUnits: "1000000000000000000",
    sellMinimumOutYen: 495,
    additionalBuyFeeYen: 2,
    additionalSellFeeYen: 3,
    quotedAtMs: NOW - 1_000,
    expiresAtMs: NOW + 5_000,
    valuationAtMs: NOW - 1_000,
    ...overrides,
  };
}

function input(overrides: Partial<SmallCapitalPaperInput> = {}): SmallCapitalPaperInput {
  return {
    nowMs: NOW,
    chainId: 8453,
    walletAddress: WALLET,
    inputToken: INPUT,
    outputToken: OUTPUT,
    requestedYen: 500,
    totalDepositedYen: 10_000,
    liquidBalanceYen: 10_000,
    committedPrincipalYen: 0,
    balanceAtMs: NOW,
    exitReserveYen: 100,
    maxRoundTripCostYen: 10,
    emergencyStop: false,
    dataQuality: "healthy",
    contractSafety: "pass",
    quote: quote(),
    ...overrides,
  };
}

describe("Base small-capital paper preflight", () => {
  it("accepts a 500 yen paper plan without a 10 USD floor or a 12% profit assumption", () => {
    expect(evaluateSmallCapitalPaper(input())).toEqual({
      mode: "paper", executionLocked: true, profitabilityVerified: false,
      status: "paper-ready", reasons: [], paperAmountYen: 500,
      estimatedRoundTripCostYen: 10, remainingLiquidYen: 9_498,
    });
  });

  it("uses only the explicitly requested amount, never all of a larger wallet", () => {
    const result = evaluateSmallCapitalPaper(input({ liquidBalanceYen: 1_000_000 }));
    expect(result.paperAmountYen).toBe(500);
    expect(result.executionLocked).toBe(true);
    expect(Object.isFrozen(SMALL_CAPITAL_POLICY)).toBe(true);
  });

  it("accepts the 1000 yen boundary with an amount-matched quote", () => {
    const result = evaluateSmallCapitalPaper(input({
      requestedYen: 1_000,
      quote: quote({ amountInYen: 1_000, sellMinimumOutYen: 995 }),
    }));
    expect(result.paperAmountYen).toBe(1_000);
  });

  it.each([
    [{ requestedYen: 1_001 }, "ORDER_CAP_EXCEEDED"],
    [{ requestedYen: 10_000 }, "ORDER_CAP_EXCEEDED"],
    [{ totalDepositedYen: 10_001 }, "FUNDING_CAP_EXCEEDED"],
    [{ totalDepositedYen: 0 }, "CAPITAL_BUDGET_EXCEEDED"],
    [{ committedPrincipalYen: 9_399 }, "CAPITAL_BUDGET_EXCEEDED"],
    [{ liquidBalanceYen: 601 }, "INSUFFICIENT_LIQUID_BALANCE"],
    [{ exitReserveYen: 2 }, "EXIT_RESERVE_INSUFFICIENT"],
    [{ maxRoundTripCostYen: 9 }, "ROUND_TRIP_COST_EXCEEDED"],
    [{ chainId: 1 }, "UNSUPPORTED_CHAIN"],
    [{ emergencyStop: true }, "EMERGENCY_STOP"],
    [{ dataQuality: "degraded" }, "DATA_NOT_HEALTHY"],
    [{ dataQuality: "unknown" }, "DATA_NOT_HEALTHY"],
    [{ contractSafety: "unknown" }, "CONTRACT_NOT_VERIFIED"],
    [{ quote: null }, "QUOTE_MISSING"],
    [{ balanceAtMs: NOW - 5_001 }, "BALANCE_STALE"],
    [{ balanceAtMs: NOW + 1 }, "BALANCE_STALE"],
  ] as const)("blocks unsafe input %j", (overrides, reason) => {
    const result = evaluateSmallCapitalPaper(input(overrides));
    expect(result.reasons).toContain(reason);
    expect(result.status).toBe("blocked");
    expect(result.paperAmountYen).toBeNull();
    expect(result.estimatedRoundTripCostYen).toBeNull();
    expect(result.executionLocked).toBe(true);
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid monetary values %s without throwing", (value) => {
      for (const key of ["requestedYen", "totalDepositedYen", "liquidBalanceYen",
        "committedPrincipalYen", "exitReserveYen", "maxRoundTripCostYen"] as const) {
        expect(evaluateSmallCapitalPaper(input({ [key]: value })).reasons).toContain("INVALID_INPUT");
      }
    },
  );

  it.each([
    { requestedYen: 0 }, { exitReserveYen: 0 }, { maxRoundTripCostYen: 500 },
    { walletAddress: "not-a-wallet" }, { outputToken: INPUT },
  ])("rejects invalid policy/asset identity %j", (overrides) => {
    expect(evaluateSmallCapitalPaper(input(overrides)).reasons).toContain("INVALID_INPUT");
  });

  it.each([
    [{ amountInYen: 1_000 }, "QUOTE_MISMATCH"],
    [{ chainId: 1 }, "QUOTE_MISMATCH"],
    [{ walletAddress: INPUT }, "QUOTE_MISMATCH"],
    [{ recipientAddress: INPUT }, "QUOTE_MISMATCH"],
    [{ inputToken: OUTPUT }, "QUOTE_MISMATCH"],
    [{ outputToken: INPUT }, "QUOTE_MISMATCH"],
    [{ sellAmountInUnits: "999999999999999999" }, "QUOTE_MISMATCH"],
    [{ quotedAtMs: NOW - 10_001 }, "QUOTE_STALE"],
    [{ quotedAtMs: NOW + 1 }, "QUOTE_STALE"],
    [{ expiresAtMs: NOW }, "QUOTE_EXPIRED"],
    [{ valuationAtMs: NOW - 10_001 }, "VALUATION_STALE"],
    [{ valuationAtMs: NOW + 1 }, "VALUATION_STALE"],
    [{ sellMinimumOutYen: 0 }, "QUOTE_INVALID"],
    [{ additionalBuyFeeYen: NaN }, "QUOTE_INVALID"],
    [{ additionalSellFeeYen: -1 }, "QUOTE_INVALID"],
    [{ buyMinimumOutUnits: "0" }, "QUOTE_INVALID"],
    [{ buyMinimumOutUnits: "1e18" }, "QUOTE_INVALID"],
    [{ sellAmountInUnits: "01" }, "QUOTE_INVALID"],
    [{ sellAmountInUnits: "9".repeat(79) }, "QUOTE_INVALID"],
    [{ sellAmountInUnits: (BigInt(1) << BigInt(256)).toString() }, "QUOTE_INVALID"],
  ] as const)("rejects an unsafe quote %j", (overrides, reason) => {
    const result = evaluateSmallCapitalPaper(input({ quote: quote(overrides) }));
    expect(result.reasons).toContain(reason);
    expect(result.paperAmountYen).toBeNull();
  });

  it("counts pending/open principal and reserves at their exact budget boundary", () => {
    expect(evaluateSmallCapitalPaper(input({
      committedPrincipalYen: 9_398, liquidBalanceYen: 602,
    })).status).toBe("paper-ready");
  });

  it("does not use an apparent arbitrage gain to subsidize fees", () => {
    const result = evaluateSmallCapitalPaper(input({
      maxRoundTripCostYen: 4,
      quote: quote({ sellMinimumOutYen: 600 }),
    }));
    expect(result.reasons).toContain("ROUND_TRIP_COST_EXCEEDED");
    expect(result.profitabilityVerified).toBe(false);
  });

  it("handles huge valid integers without overflow or throwing", () => {
    const result = evaluateSmallCapitalPaper(input({
      committedPrincipalYen: Number.MAX_SAFE_INTEGER,
      quote: quote({ additionalBuyFeeYen: Number.MAX_SAFE_INTEGER }),
    }));
    expect(result.status).toBe("blocked");
    expect(result.paperAmountYen).toBeNull();
  });

  it("never mutates a snapshot or reserves funds while evaluating it", () => {
    const value = input();
    Object.freeze(value.quote);
    Object.freeze(value);
    expect(evaluateSmallCapitalPaper(value)).toEqual(evaluateSmallCapitalPaper(value));
    expect(value.committedPrincipalYen).toBe(0);
  });
});
