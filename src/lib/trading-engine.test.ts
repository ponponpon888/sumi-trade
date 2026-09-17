import { beforeEach, describe, expect, it, vi } from "vitest";

import { DataSourceHttpError } from "@/lib/data-source-failure";
import { getPoolOhlcv } from "@/lib/ohlcv";
import { getChartModelSnapshot } from "@/lib/trading-engine";
import type { OhlcvCandle, PortfolioAsset, PortfolioSnapshot } from "@/lib/types";

vi.mock("@/lib/ohlcv", () => ({ getPoolOhlcv: vi.fn() }));

const INTERVAL = 5 * 60;

function candles(count: number, ageSeconds = 0): OhlcvCandle[] {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const lastClosedStart = Math.floor(nowSeconds / INTERVAL) * INTERVAL - INTERVAL - ageSeconds;
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin(index / 7) * 3 + index * 0.01;
    return {
      timestamp: lastClosedStart - (count - 1 - index) * INTERVAL,
      open: close - 0.2,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1_000 + index,
    };
  });
}

function asset(symbol: string, valueUsd: number, pairAddress: string): PortfolioAsset {
  return {
    symbol,
    name: symbol,
    contractAddress: symbol === "ETH" ? null : `0x${valueUsd.toString(16).padStart(40, "0")}`,
    amount: 1,
    priceUsd: 1,
    valueUsd,
    liquidityUsd: 1_000_000,
    volume24hUsd: 100_000,
    priceChange24h: 0,
    tradability: symbol === "ETH" ? "gas" : "eligible",
    reason: "test",
    pairUrl: null,
    pairAddress,
    dexId: null,
    contractSafety: null,
    quotePreflight: null,
    onchainPreflight: null,
  };
}

function snapshot(assets: PortfolioAsset[]): PortfolioSnapshot {
  return {
    walletAddress: "0x0000000000000000000000000000000000000001",
    generatedAt: new Date().toISOString(),
    source: "blockscout+dexscreener",
    totalUsd: assets.reduce((total, item) => total + item.valueUsd, 0),
    tradeableUsd: 0,
    blockedUsd: 0,
    gasBalanceEth: 0.01,
    gasBalanceUsd: 25,
    gasReserveEth: 0.005,
    assets,
    ignoredTokenCount: 0,
    warnings: [],
  };
}

describe("GeckoTerminal source checks", () => {
  beforeEach(() => {
    // Braces matter: returning the mock would make Vitest call it as a teardown hook.
    vi.mocked(getPoolOhlcv).mockReset();
  });

  it("separates a thrown request, stale candles and insufficient candles", async () => {
    const responses: Record<string, () => Promise<OhlcvCandle[]>> = {
      "pair-ready": async () => candles(300),
      "pair-stale": async () => candles(300, 2 * 60 * 60),
      "pair-short": async () => candles(100),
      "pair-limited": async () => {
        throw new DataSourceHttpError(429, "limited");
      },
      "pair-eth": async () => candles(48),
    };
    vi.mocked(getPoolOhlcv).mockImplementation((pairAddress) => responses[pairAddress]());

    const chartModel = await getChartModelSnapshot(
      snapshot([
        asset("READY", 500, "pair-ready"),
        asset("STALE", 400, "pair-stale"),
        asset("SHORT", 300, "pair-short"),
        asset("LIMITED", 200, "pair-limited"),
        asset("ETH", 25, "pair-eth"),
      ]),
    );

    expect(chartModel.analyses.map((analysis) => [analysis.symbol, analysis.status])).toEqual([
      ["READY", "ready"],
      ["STALE", "unavailable"],
      ["SHORT", "insufficient"],
      ["LIMITED", "unavailable"],
    ]);
    expect(chartModel.ethBenchmark.status).toBe("ready");
    expect(chartModel.sourceChecks?.geckoterminal).toEqual([
      { outcome: "success" },
      { outcome: "source-stale" },
      { outcome: "policy-blocked" },
      { outcome: "source-unavailable", failureKind: "rate-limited" },
      { outcome: "success" },
    ]);
  });

  it("classifies the ETH benchmark as stale, insufficient or unavailable", async () => {
    const run = async (loader: () => Promise<OhlcvCandle[]>) => {
      vi.mocked(getPoolOhlcv).mockImplementation(loader);
      const chartModel = await getChartModelSnapshot(snapshot([asset("ETH", 25, "pair-eth")]));
      return chartModel.sourceChecks?.geckoterminal;
    };

    expect(await run(async () => candles(48, 2 * 60 * 60))).toEqual([{ outcome: "source-stale" }]);
    expect(await run(async () => candles(5))).toEqual([{ outcome: "policy-blocked" }]);
    expect(
      await run(async () => {
        throw new DOMException("timed out", "TimeoutError");
      }),
    ).toEqual([{ outcome: "source-unavailable", failureKind: "timeout" }]);
  });

  it("records no benchmark target when ETH has no pair", async () => {
    const eth = { ...asset("ETH", 25, "unused"), pairAddress: null };
    const chartModel = await getChartModelSnapshot(snapshot([eth]));
    expect(chartModel.sourceChecks?.geckoterminal).toEqual([]);
    expect(getPoolOhlcv).not.toHaveBeenCalled();
  });
});
