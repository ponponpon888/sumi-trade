import { describe, expect, it } from "vitest";

import {
  BaseFundingPlanningError,
  type BaseFundingPlanningInput,
  evaluateBaseFundingPlanning,
} from "@/lib/base-funding-planning";
import { SMALL_CAPITAL_POLICY } from "@/lib/small-capital-paper";

const ETH_JPY = 500_000; // 1 JPY = 2e12 wei at this valuation.
const PRINCIPAL_500 = "1000000000000000"; // 500 JPY / 500,000 JPY per ETH.
const PRINCIPAL_1000 = "2000000000000000";
const KNOWN_COST_YEN = 7;
const PROVIDER_COST_YEN = 9;
const PROVIDER_COST_WEI = "18000000000000"; // 9 * 2e12
const KNOWN_COST_WEI = "14000000000000"; // 7 * 2e12
const REFERENCE_WITH_PROVIDER = "1018000000000000";
const REFERENCE_WITHOUT_PROVIDER = "1014000000000000";
const MAX_UINT256 = ((BigInt(1) << BigInt(256)) - BigInt(1)).toString();

const ALWAYS_UNPRICED = [
  "USER_OPERATION_GAS",
  "BUNDLER_FEE",
  "PAYMASTER_FEE",
  "SIGNER_FEE",
  "BUNDLE_L1_FEE_ALLOCATION",
  "EXECUTION_TIME_OPERATOR_FEE",
  "PRICE_AND_GAS_MOVEMENT",
];

function input(overrides: Partial<BaseFundingPlanningInput> = {}): BaseFundingPlanningInput {
  return {
    requestedYen: 500,
    principalWei: PRINCIPAL_500,
    nativeBalanceWei: "0",
    ethJpy: ETH_JPY,
    knownCostEstimateYen: KNOWN_COST_YEN,
    providerKnownCostEstimateYen: PROVIDER_COST_YEN,
    smartAccountDeployed: false,
    sellLegAllowanceCovered: false,
    ...overrides,
  };
}

function rejection(value: unknown): BaseFundingPlanningError {
  let caught: unknown;
  try {
    evaluateBaseFundingPlanning(value as BaseFundingPlanningInput);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BaseFundingPlanningError);
  const typed = caught as BaseFundingPlanningError;
  // The message carries the stable code only.
  expect(typed.message).toBe(typed.code);
  return typed;
}

describe("Base funding planning arithmetic", () => {
  it("reports an empty wallet without naming any amount to deposit", () => {
    expect(evaluateBaseFundingPlanning(input())).toEqual({
      totalCapitalLimitYen: 10_000,
      perTradeLimitYen: 1_000,
      capitalBudgetEvaluated: false,
      policyReserveYen: null,
      requestedYen: 500,
      principalWei: PRINCIPAL_500,
      nativeBalanceWei: "0",
      principalShortfallWei: PRINCIPAL_500,
      costBasis: "WITH_PROVIDER_L1_FEE",
      estimatedKnownCostYen: PROVIDER_COST_YEN,
      estimatedKnownCostWei: PROVIDER_COST_WEI,
      estimatedFundingReferenceWei: REFERENCE_WITH_PROVIDER,
      estimatedFundingReferenceGapWei: REFERENCE_WITH_PROVIDER,
      planningTargetWei: null,
      planningShortfallWei: null,
      fundingSufficient: null,
      unpricedCosts: [
        "SMART_ACCOUNT_DEPLOYMENT",
        "USER_OPERATION_GAS",
        "BUNDLER_FEE",
        "PAYMASTER_FEE",
        "SIGNER_FEE",
        "APPROVAL_TRANSACTION",
        "BUNDLE_L1_FEE_ALLOCATION",
        "EXECUTION_TIME_OPERATOR_FEE",
        "PRICE_AND_GAS_MOVEMENT",
      ],
    });
  });

  it("matches the frozen policy rather than repeating its numbers", () => {
    const result = evaluateBaseFundingPlanning(input());
    expect(result.totalCapitalLimitYen).toBe(SMALL_CAPITAL_POLICY.maxFundingYen);
    expect(result.perTradeLimitYen).toBe(SMALL_CAPITAL_POLICY.maxOrderYen);
    // No cumulative deposit total exists here, so the funding cap stays unjudged.
    expect(result.capitalBudgetEvaluated).toBe(false);
  });

  it.each([
    ["balance zero", "0", PRINCIPAL_500],
    ["one wei short of the principal", "999999999999999", "1"],
    ["exactly the principal", PRINCIPAL_500, "0"],
    ["above the principal", "1000000000000001", "0"],
    ["far above the principal", REFERENCE_WITH_PROVIDER, "0"],
  ])("settles the principal shortfall for %s", (_label, nativeBalanceWei, expected) => {
    expect(evaluateBaseFundingPlanning(input({ nativeBalanceWei })).principalShortfallWei)
      .toBe(expected);
  });

  it.each([
    ["balance zero", "0", REFERENCE_WITH_PROVIDER],
    ["one wei below the reference", "1017999999999999", "1"],
    ["exactly the reference", REFERENCE_WITH_PROVIDER, "0"],
    ["one wei above the reference", "1018000000000001", "0"],
  ])("measures the distance to the reference figure for %s", (_label, nativeBalanceWei, expected) => {
    const result = evaluateBaseFundingPlanning(input({ nativeBalanceWei }));
    expect(result.estimatedFundingReferenceGapWei).toBe(expected);
    // Closing the gap still proves nothing: unpriced costs remain either way.
    expect(result.fundingSufficient).toBeNull();
    expect(result.unpricedCosts.length).toBeGreaterThan(0);
  });

  it("keeps the principal exactly as supplied instead of recomputing it", () => {
    const result = evaluateBaseFundingPlanning(input({ principalWei: "1000000000000001" }));
    expect(result.principalWei).toBe("1000000000000001");
    expect(result.estimatedFundingReferenceWei).toBe("1018000000000001");
  });

  it("compares values beyond 2^53 exactly", () => {
    const principalWei = "9007199254740993";
    const nativeBalanceWei = "9007199254740992";
    // A float comparison would see these as equal and report no shortfall.
    expect(Number(principalWei)).toBe(Number(nativeBalanceWei));
    const result = evaluateBaseFundingPlanning(input({
      principalWei,
      nativeBalanceWei,
      knownCostEstimateYen: 0,
      providerKnownCostEstimateYen: 0,
    }));
    expect(result.principalShortfallWei).toBe("1");
    expect(result.estimatedFundingReferenceWei).toBe(principalWei);
    expect(result.estimatedFundingReferenceGapWei).toBe("1");
  });

  it("accepts a uint256 maximum balance and principal", () => {
    expect(evaluateBaseFundingPlanning(input({
      nativeBalanceWei: MAX_UINT256,
      providerKnownCostEstimateYen: 0,
    }))).toMatchObject({
      principalShortfallWei: "0",
      estimatedKnownCostWei: "0",
      estimatedFundingReferenceGapWei: "0",
    });
    expect(evaluateBaseFundingPlanning(input({
      principalWei: MAX_UINT256,
      providerKnownCostEstimateYen: 0,
    })).estimatedFundingReferenceWei).toBe(MAX_UINT256);
  });

  it.each([
    ["principal at the uint256 maximum plus one yen of cost", {
      principalWei: MAX_UINT256, providerKnownCostEstimateYen: 1,
    }],
    ["the maximum principal plus a very large converted cost", {
      principalWei: MAX_UINT256,
      providerKnownCostEstimateYen: Number.MAX_SAFE_INTEGER,
      ethJpy: 0.000001,
    }],
  ])("fails closed when the computed total overflows: %s", (_label, overrides) => {
    expect(rejection(input(overrides as Partial<BaseFundingPlanningInput>)).code)
      .toBe("FUNDING_PLANNING_OVERFLOW");
  });

  it.each([
    ["integer valuation with a remainder", 3, 1, "333333333333333334"],
    ["decimal valuation dividing evenly", 2.5, 1, "400000000000000000"],
    ["decimal valuation with a remainder", 1.5, 1, "666666666666666667"],
    ["zero cost stays zero", ETH_JPY, 0, "0"],
  ])("rounds the yen cost up to whole wei: %s", (_label, ethJpy, yen, expected) => {
    const result = evaluateBaseFundingPlanning(input({
      ethJpy,
      providerKnownCostEstimateYen: yen,
      principalWei: "1",
    }));
    expect(result.estimatedKnownCostWei).toBe(expected);
    expect(result.estimatedFundingReferenceWei).toBe((BigInt(expected) + BigInt(1)).toString());
  });

  it("uses the provider total when it is present", () => {
    const result = evaluateBaseFundingPlanning(input());
    expect(result.costBasis).toBe("WITH_PROVIDER_L1_FEE");
    expect(result.estimatedKnownCostYen).toBe(PROVIDER_COST_YEN);
    expect(result.estimatedKnownCostWei).toBe(PROVIDER_COST_WEI);
    expect(result.estimatedFundingReferenceWei).toBe(REFERENCE_WITH_PROVIDER);
    expect(result.unpricedCosts).not.toContain("PROVIDER_L1_FEE");
  });

  it("never treats a missing provider L1 fee as zero", () => {
    const result = evaluateBaseFundingPlanning(input({ providerKnownCostEstimateYen: null }));
    expect(result.costBasis).toBe("WITHOUT_PROVIDER_L1_FEE");
    // The smaller cost total is used and the absent fee is reported, not assumed zero.
    expect(result.estimatedKnownCostYen).toBe(KNOWN_COST_YEN);
    expect(result.estimatedKnownCostWei).toBe(KNOWN_COST_WEI);
    expect(result.estimatedFundingReferenceWei).toBe(REFERENCE_WITHOUT_PROVIDER);
    expect(result.unpricedCosts).toContain("PROVIDER_L1_FEE");
  });

  it("reports a genuinely zero known cost without changing the basis", () => {
    const result = evaluateBaseFundingPlanning(input({ providerKnownCostEstimateYen: 0 }));
    expect(result.costBasis).toBe("WITH_PROVIDER_L1_FEE");
    expect(result.estimatedKnownCostYen).toBe(0);
    expect(result.estimatedKnownCostWei).toBe("0");
    expect(result.estimatedFundingReferenceWei).toBe(PRINCIPAL_500);
    expect(result.unpricedCosts).not.toContain("PROVIDER_L1_FEE");
  });

  it.each([
    [500, PRINCIPAL_500],
    [1_000, PRINCIPAL_1000],
  ])("plans the %s yen amount from its own principal", (requestedYen, principalWei) => {
    const result = evaluateBaseFundingPlanning(input({
      requestedYen: requestedYen as 500 | 1000,
      principalWei,
    }));
    expect(result.requestedYen).toBe(requestedYen);
    expect(result.principalWei).toBe(principalWei);
    expect(result.principalShortfallWei).toBe(principalWei);
    expect(requestedYen).toBeLessThanOrEqual(SMALL_CAPITAL_POLICY.maxOrderYen);
  });

  it.each([1_001, 2_000, 10_000, 499, 0, -500, 500.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an unsupported requested amount %s", (requestedYen) => {
      expect(rejection(input({ requestedYen: requestedYen as 500 | 1000 })).code)
        .toBe("FUNDING_PLANNING_INVALID_INPUT");
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "7", null])(
    "rejects an invalid knownCostEstimateYen %s", (value) => {
      expect(rejection(input({
        knownCostEstimateYen: value as number,
        providerKnownCostEstimateYen: null,
      })).code).toBe("FUNDING_PLANNING_INVALID_INPUT");
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "9"])(
    "rejects an invalid providerKnownCostEstimateYen %s", (value) => {
      expect(rejection(input({ providerKnownCostEstimateYen: value as number })).code)
        .toBe("FUNDING_PLANNING_INVALID_INPUT");
    },
  );

  it.each([
    ["zero", 0],
    ["negative", -500_000],
    ["not a number", "500000"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["exponent form beyond the decimal pattern", 1e21],
    ["below the decimal pattern", 1e-7],
    ["null", null],
  ])("rejects an invalid ethJpy: %s", (_label, ethJpy) => {
    expect(rejection(input({ ethJpy: ethJpy as number })).code)
      .toBe("FUNDING_PLANNING_INVALID_INPUT");
  });

  it.each([
    ["leading zero", "0100000000000000"],
    ["hex", "0x38d7ea4c68000"],
    ["negative", "-1000000000000000"],
    ["decimal", "1000000000000000.5"],
    ["exponent", "1e15"],
    ["empty", ""],
    ["whitespace", " 1000000000000000 "],
    ["number", 1_000_000_000_000_000],
    ["null", null],
    ["above uint256", ((BigInt(1) << BigInt(256))).toString()],
    ["79 digits", "9".repeat(79)],
    ["zero principal", "0"],
  ])("rejects an invalid principalWei: %s", (_label, principalWei) => {
    expect(rejection(input({ principalWei: principalWei as string })).code)
      .toBe("FUNDING_PLANNING_INVALID_INPUT");
  });

  it.each([
    ["leading zero", "00"],
    ["hex", "0x0"],
    ["negative", "-1"],
    ["decimal", "0.5"],
    ["number", 0],
    ["null", null],
    ["above uint256", ((BigInt(1) << BigInt(256))).toString()],
  ])("rejects an invalid nativeBalanceWei: %s", (_label, nativeBalanceWei) => {
    expect(rejection(input({ nativeBalanceWei: nativeBalanceWei as string })).code)
      .toBe("FUNDING_PLANNING_INVALID_INPUT");
  });

  it("accepts a zero balance but not a zero principal", () => {
    expect(evaluateBaseFundingPlanning(input({ nativeBalanceWei: "0" })).nativeBalanceWei).toBe("0");
    expect(rejection(input({ principalWei: "0" })).code).toBe("FUNDING_PLANNING_INVALID_INPUT");
  });

  it.each([
    ["deployed", true, false],
    ["undeployed", false, true],
  ])("lists the deployment cost only when the account is %s", (_label, deployed, listed) => {
    const result = evaluateBaseFundingPlanning(input({ smartAccountDeployed: deployed }));
    expect(result.unpricedCosts.includes("SMART_ACCOUNT_DEPLOYMENT")).toBe(listed);
  });

  it.each([
    ["covered", true, false],
    ["insufficient", false, true],
  ])("lists the approval cost only when the allowance is %s", (_label, covered, listed) => {
    const result = evaluateBaseFundingPlanning(input({ sellLegAllowanceCovered: covered }));
    expect(result.unpricedCosts.includes("APPROVAL_TRANSACTION")).toBe(listed);
  });

  it("keeps a fixed unpriced-cost order in every combination", () => {
    const all = evaluateBaseFundingPlanning(input({
      smartAccountDeployed: false,
      sellLegAllowanceCovered: false,
      providerKnownCostEstimateYen: null,
    }));
    expect(all.unpricedCosts).toEqual([
      "SMART_ACCOUNT_DEPLOYMENT",
      "USER_OPERATION_GAS",
      "BUNDLER_FEE",
      "PAYMASTER_FEE",
      "SIGNER_FEE",
      "APPROVAL_TRANSACTION",
      "BUNDLE_L1_FEE_ALLOCATION",
      "EXECUTION_TIME_OPERATOR_FEE",
      "PRICE_AND_GAS_MOVEMENT",
      "PROVIDER_L1_FEE",
    ]);

    const fewest = evaluateBaseFundingPlanning(input({
      smartAccountDeployed: true,
      sellLegAllowanceCovered: true,
      providerKnownCostEstimateYen: PROVIDER_COST_YEN,
    }));
    // Even in the best observed case, seven costs still carry no price at all.
    expect(fewest.unpricedCosts).toEqual(ALWAYS_UNPRICED);
    expect(fewest.fundingSufficient).toBeNull();
  });

  it.each([
    ["undeployed and uncovered", { smartAccountDeployed: false, sellLegAllowanceCovered: false }],
    ["deployed and covered", { smartAccountDeployed: true, sellLegAllowanceCovered: true }],
    ["balance above the reference", { nativeBalanceWei: MAX_UINT256 }],
    ["no provider total", { providerKnownCostEstimateYen: null }],
    ["zero cost", { providerKnownCostEstimateYen: 0 }],
  ])("keeps every unproven value null for %s", (_label, overrides) => {
    const result = evaluateBaseFundingPlanning(input(overrides as Partial<BaseFundingPlanningInput>));
    expect(result.fundingSufficient).toBeNull();
    expect(result.planningTargetWei).toBeNull();
    expect(result.planningShortfallWei).toBeNull();
    expect(result.policyReserveYen).toBeNull();
    expect(result.capitalBudgetEvaluated).toBe(false);
  });

  it.each([true, false, 1, "true", null, undefined])(
    "rejects a non-boolean deployment or allowance flag %s", (value) => {
      const valid = typeof value === "boolean";
      for (const key of ["smartAccountDeployed", "sellLegAllowanceCovered"] as const) {
        const candidate = input({ [key]: value } as Partial<BaseFundingPlanningInput>);
        if (valid) {
          expect(evaluateBaseFundingPlanning(candidate).fundingSufficient).toBeNull();
        } else {
          expect(rejection(candidate).code).toBe("FUNDING_PLANNING_INVALID_INPUT");
        }
      }
    },
  );

  it.each([null, undefined, "input", 42])("rejects a non-object input %s", (value) => {
    expect(rejection(value).code).toBe("FUNDING_PLANNING_INVALID_INPUT");
  });

  it("returns the same result for the same input and does not mutate it", () => {
    const value = Object.freeze(input());
    const first = evaluateBaseFundingPlanning(value);
    const second = evaluateBaseFundingPlanning(value);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(value.nativeBalanceWei).toBe("0");
  });

  it("never exposes an input value or any address-like data in an error", () => {
    const error = rejection(input({ principalWei: "0xsecret-wallet-0000000000000000000000000000" }));
    const serialized = JSON.stringify({
      ...error,
      message: error.message,
      stack: error.stack,
      code: error.code,
    });
    expect(error.code).toBe("FUNDING_PLANNING_INVALID_INPUT");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("0x");
  });

  it("returns no address, destination, link or deposit wording", () => {
    const serialized = JSON.stringify(evaluateBaseFundingPlanning(input()));
    for (const forbidden of ["0x", "address", "recipient", "deposit", "qr", "http", "calldata", "approve"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
  });
});
