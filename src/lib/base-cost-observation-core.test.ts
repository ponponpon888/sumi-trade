import { describe, expect, it } from "vitest";

import {
  baseCostBucketId,
  createObservedBaseCostRecord,
  createUnavailableBaseCostRecord,
  isBaseCostRecord,
  summarizeBaseCost,
  type BaseCostQuoteInput,
  type BaseCostRecord,
} from "@/lib/base-cost-observation-core";

const HOUR_MS = 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 8, 23, 12, 30);

function quote(knownCostEstimateYen: number, overrides: Partial<BaseCostQuoteInput> = {}): BaseCostQuoteInput {
  return {
    requestedYen: 500,
    valuation: { ethJpy: 600_000, ethUsd: 4_000 },
    providerSwapGasEstimateYen: { buy: 1, sell: 1 },
    swapShortfallEstimateYen: knownCostEstimateYen - 2,
    knownCostEstimateYen,
    providerL1FeeEstimateYen: { total: 1 },
    providerKnownCostEstimateYen: knownCostEstimateYen + 1,
    ...overrides,
  };
}

function observedAt(hoursAgo: number, cost: number): BaseCostRecord {
  return createObservedBaseCostRecord(quote(cost), NOW - hoursAgo * HOUR_MS);
}

describe("Base cost records", () => {
  it("keeps only the cost fields and locks execution", () => {
    const record = createObservedBaseCostRecord(quote(8), NOW);
    expect(record).toEqual({
      schemaVersion: 1,
      id: baseCostBucketId(NOW),
      bucketTimeMs: Date.UTC(2026, 8, 23, 12),
      observedAt: new Date(NOW).toISOString(),
      requestedYen: 500,
      executionLocked: true,
      status: "observed",
      ethJpy: 600_000,
      ethUsd: 4_000,
      swapShortfallEstimateYen: 6,
      swapGasEstimateYen: 2,
      knownCostEstimateYen: 8,
      providerL1FeeEstimateYen: 1,
      providerKnownCostEstimateYen: 9,
    });
    expect(isBaseCostRecord(record)).toBe(true);
  });

  it("rejects quotes for any amount other than 500 yen", () => {
    expect(() => createObservedBaseCostRecord(quote(8, { requestedYen: 1000 }), NOW)).toThrow();
  });

  it("stores only known provider error codes", () => {
    expect(createUnavailableBaseCostRecord("QUOTE_STALE", NOW)).toMatchObject({
      status: "unavailable",
      errorCode: "QUOTE_STALE",
    });
    expect(createUnavailableBaseCostRecord("fetch failed: https://secret.example", NOW)).toMatchObject({
      errorCode: "UNKNOWN",
    });
  });

  it("rejects malformed stored values", () => {
    const record = createObservedBaseCostRecord(quote(8), NOW);
    expect(isBaseCostRecord({ ...record, executionLocked: false })).toBe(false);
    expect(isBaseCostRecord({ ...record, knownCostEstimateYen: "8" })).toBe(false);
    expect(isBaseCostRecord({ ...record, providerL1FeeEstimateYen: null })).toBe(true);
    expect(isBaseCostRecord(null)).toBe(false);
  });
});

describe("summarizeBaseCost", () => {
  it("reports the cost distribution as a share of the 500 yen round trip", () => {
    const records = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20].map((cost, index) => observedAt(index, cost));
    const day = summarizeBaseCost(records, NOW).windows[0];
    expect(day).toMatchObject({
      hours: 24,
      attemptCount: 10,
      observedCount: 10,
      availabilityPercent: 100,
      medianCostPercent: 2,
      p90CostPercent: 3.6,
      maxCostPercent: 4,
      l1FeeReportedCount: 10,
    });
  });

  it("counts failed hours against availability by error code", () => {
    const records = [
      observedAt(0, 5),
      createUnavailableBaseCostRecord("PROVIDER_RATE_LIMITED", NOW - HOUR_MS),
      createUnavailableBaseCostRecord("PROVIDER_RATE_LIMITED", NOW - 2 * HOUR_MS),
      createUnavailableBaseCostRecord("QUOTE_STALE", NOW - 3 * HOUR_MS),
    ];
    expect(summarizeBaseCost(records, NOW).windows[0]).toMatchObject({
      attemptCount: 4,
      observedCount: 1,
      availabilityPercent: 25,
      errorCounts: { PROVIDER_RATE_LIMITED: 2, QUOTE_STALE: 1 },
    });
  });

  it("separates the 24 hour, 7 day and 30 day windows", () => {
    const summary = summarizeBaseCost(
      [observedAt(1, 5), observedAt(30, 5), observedAt(200, 5)],
      NOW,
    );
    expect(summary.windows.map((window) => [window.hours, window.attemptCount]))
      .toEqual([[24, 1], [168, 2], [720, 3]]);
  });

  it("puts the Ethereum cost model beside the observation at the latest ETH price", () => {
    const summary = summarizeBaseCost([observedAt(0, 5)], NOW);
    // 500 yen is about $3.33, so two fixed mainnet swap gas fees dwarf the trade.
    expect(summary.ethereumModelCostPercent!).toBeGreaterThan(100);
    expect(summary.lastObservedAt).toBe(new Date(NOW).toISOString());
    expect(summarizeBaseCost([], NOW).ethereumModelCostPercent).toBeNull();
  });
});
