import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getQuote, store } = vi.hoisted(() => ({
  getQuote: vi.fn(),
  store: new Map<string, unknown>(),
}));

vi.mock("@/lib/base-paper-quote", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/base-paper-quote")>(),
  getBasePaperQuote: getQuote,
}));

vi.mock("@upstash/redis", () => {
  class Redis {
    async set(key: string, value: unknown, options?: { nx?: boolean }) {
      if (options?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }
    pipeline() {
      const operations: Array<() => void> = [];
      const pipeline = {
        set: (key: string, value: unknown) => { operations.push(() => store.set(key, value)); return pipeline; },
        zadd: (key: string, entry: { score: number; member: string }) => {
          operations.push(() => {
            const index = (store.get(key) as Map<string, number> | undefined) ?? new Map<string, number>();
            index.set(entry.member, entry.score);
            store.set(key, index);
          });
          return pipeline;
        },
        zremrangebyscore: () => pipeline,
        expire: () => pipeline,
        exec: async () => { for (const operation of operations) operation(); return []; },
      };
      return pipeline;
    }
    async zrange(key: string, min: number, max: number) {
      const index = (store.get(key) as Map<string, number> | undefined) ?? new Map<string, number>();
      return [...index].filter(([, score]) => score >= min && score <= max).map(([member]) => member);
    }
    async mget(...keys: string[]) {
      return keys.map((key) => store.get(key) ?? null);
    }
  }
  return { Redis };
});

import { BasePaperQuoteError } from "@/lib/base-paper-quote";
import { getBaseCostSummary, recordBaseCostObservation } from "@/lib/base-cost-observation";

const NOW = Date.UTC(2026, 8, 23, 12, 17);

function quoteResult() {
  return {
    requestedYen: 500,
    valuation: { ethJpy: 600_000, ethUsd: 4_000 },
    providerSwapGasEstimateYen: { buy: 1, sell: 1 },
    swapShortfallEstimateYen: 5,
    knownCostEstimateYen: 7,
    providerL1FeeEstimateYen: { total: null },
    providerKnownCostEstimateYen: null,
  };
}

beforeEach(() => {
  store.clear();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("recordBaseCostObservation", () => {
  it("does nothing without storage", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("KV_REST_API_URL", "");
    expect(await recordBaseCostObservation(NOW)).toEqual({ status: "storage-unavailable" });
    expect(getQuote).not.toHaveBeenCalled();
  });

  it("requests one 500 yen quote per hour, even when the cron runs twice", async () => {
    getQuote.mockResolvedValue(quoteResult());
    const first = await recordBaseCostObservation(NOW);
    const retry = await recordBaseCostObservation(NOW + 5 * 60 * 1_000);

    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(getQuote).toHaveBeenCalledWith(500);
    expect(first).toMatchObject({
      status: "recorded",
      record: { status: "observed", knownCostEstimateYen: 7, bucketTimeMs: Date.UTC(2026, 8, 23, 12) },
    });
    expect(retry.status).toBe("skipped-duplicate");
  });

  it("records a failed hour with its stable error code only", async () => {
    getQuote.mockRejectedValue(new BasePaperQuoteError("PROVIDER_RATE_LIMITED"));
    expect(await recordBaseCostObservation(NOW)).toMatchObject({
      record: { status: "unavailable", errorCode: "PROVIDER_RATE_LIMITED" },
    });
    getQuote.mockRejectedValue(new Error("socket hang up at https://internal"));
    expect(await recordBaseCostObservation(NOW + 60 * 60 * 1_000)).toMatchObject({
      record: { status: "unavailable", errorCode: "UNKNOWN" },
    });
  });

  it("summarizes what was stored", async () => {
    getQuote.mockResolvedValue(quoteResult());
    await recordBaseCostObservation(NOW);
    const summary = await getBaseCostSummary(NOW + 60_000);
    expect(summary?.windows[0]).toMatchObject({ attemptCount: 1, observedCount: 1, medianCostPercent: 1.4 });
  });
});
