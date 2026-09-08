import { describe, expect, it } from "vitest";

import { createTrendScoutSnapshot } from "@/lib/trend-scout-core";
import type { EthereumTrendingPool } from "@/lib/trend-source-core";
import type { PortfolioSnapshot } from "@/lib/types";

const NOW = Date.UTC(2026, 8, 8);
const TOKEN = "0x1111111111111111111111111111111111111111";
const PASS_SAFETY = {
  status: "pass" as const,
  source: "blockscout" as const,
  verified: true,
  isContract: true,
  isScam: false,
  isProxy: false,
  implementationAddress: null,
  erc20InterfacePassed: true,
  privilegedFunctions: [],
  reasons: ["test"],
};
const SAFETY = new Map([[TOKEN, PASS_SAFETY]]);
const PASS_PREFLIGHT = {
  status: "pass" as const,
  provider: "kyberswap" as const,
  testAmountUsd: 50,
  buy: null,
  sell: null,
  roundTripRetentionPercent: 99,
  roundTripLossPercent: 1,
  quoteTtlSeconds: 30 as const,
  reasons: ["test"],
};
const PREFLIGHT = new Map([[TOKEN, PASS_PREFLIGHT]]);

function snapshot(): PortfolioSnapshot {
  return {
    walletAddress: "0x0000000000000000000000000000000000000001",
    generatedAt: new Date(NOW).toISOString(),
    source: "blockscout+dexscreener",
    totalUsd: 1_000,
    tradeableUsd: 1_000,
    blockedUsd: 0,
    gasBalanceEth: 0.01,
    gasBalanceUsd: 25,
    gasReserveEth: 0.005,
    ignoredTokenCount: 0,
    warnings: [],
    assets: [{
      symbol: "PEPE",
      name: "Pepe",
      contractAddress: "0x6982508145454ce325ddbe47a25d4ec3d2311933",
      amount: 2_000,
      priceUsd: 0.1,
      valueUsd: 200,
      liquidityUsd: 2_000_000,
      volume24hUsd: 1_000_000,
      priceChange24h: -2,
      tradability: "eligible",
      reason: "eligible",
      pairUrl: null,
      pairAddress: null,
      dexId: null,
      contractSafety: PASS_SAFETY,
      quotePreflight: PASS_PREFLIGHT,
      onchainPreflight: null,
    }],
  };
}

function pool(overrides: Partial<EthereumTrendingPool> = {}): EthereumTrendingPool {
  return {
    rank: 1,
    contractAddress: TOKEN,
    quoteContractAddress: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    pairAddress: "0x2222222222222222222222222222222222222222",
    name: "Trend Token",
    symbol: "TREND",
    priceUsd: 1,
    liquidityUsd: 2_000_000,
    volume24hUsd: 1_000_000,
    priceChange1h: 4,
    priceChange6h: 15,
    priceChange24h: 30,
    buyers24h: 600,
    sellers24h: 400,
    sentimentPositivePercentage: 75,
    sentimentNegativePercentage: 25,
    suspiciousReportCount: 0,
    poolCreatedAt: new Date(NOW - 100 * 24 * 60 * 60 * 1_000).toISOString(),
    ...overrides,
  };
}

describe("community trend shadow model", () => {
  it("creates an execution-locked paper rotation after every hard gate passes", () => {
    const result = createTrendScoutSnapshot(
      [pool()],
      snapshot(),
      NOW,
      SAFETY,
      PREFLIGHT,
    );
    expect(result.candidates[0]).toMatchObject({
      symbol: "TREND",
      decision: "PAPER",
    });
    expect(result.paperRotation).toMatchObject({
      fromSymbol: "PEPE",
      toSymbol: "TREND",
      amountUsd: 40,
      executionLocked: true,
    });
    expect(result.paperRotation?.estimatedPriceImpactPercent).toBeGreaterThan(0);
    expect(result.paperRotation?.estimatedOneWaySlippagePercent).toBeGreaterThan(0.35);
  });

  it("blocks shallow promoted markets even when they rank first", () => {
    const result = createTrendScoutSnapshot(
      [pool({ liquidityUsd: 25_000, volume24hUsd: 2_000 })],
      snapshot(),
      NOW,
      SAFETY,
      PREFLIGHT,
    );
    expect(result.candidates[0].decision).toBe("BLOCK");
    expect(result.paperRotation).toBeNull();
  });

  it("blocks pools with repeated community suspicious reports", () => {
    const result = createTrendScoutSnapshot(
      [pool({ suspiciousReportCount: 3 })],
      snapshot(),
      NOW,
      SAFETY,
      PREFLIGHT,
    );
    expect(result.candidates[0].reasons).toContain("不審報告が多い");
    expect(result.candidates[0].decision).toBe("BLOCK");
  });

  it("blocks a trend token when contract verification is unavailable", () => {
    const result = createTrendScoutSnapshot([pool()], snapshot(), NOW);

    expect(result.candidates[0].decision).toBe("BLOCK");
    expect(result.candidates[0].contractSafety.status).toBe("unavailable");
  });
});
