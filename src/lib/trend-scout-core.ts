import { estimateExecutionCost } from "@/lib/execution-cost";
import type { EthereumTrendingPool } from "@/lib/trend-source-core";
import type {
  ContractSafetyAssessment,
  PreflightAssessment,
  PortfolioAsset,
  PortfolioSnapshot,
  TrendCandidate,
  TrendPaperRotation,
  TrendScoutSnapshot,
} from "@/lib/types";

const ETHEREUM_ADDRESS = /^0x[a-f0-9]{40}$/;
const MIN_LIQUIDITY_USD = 750_000;
const MIN_VOLUME_24H_USD = 250_000;
const MIN_POOL_AGE_DAYS = 30;
const MAX_SUSPICIOUS_REPORTS = 2;
const MAX_DISPLAY_CANDIDATES = 6;
const MAX_ROTATION_PERCENT = 5;
const SOURCE_POSITION_PERCENT = 20;
const MIN_PAPER_ROTATION_USD = 10;

const TRUSTED_QUOTES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "0xdac17f958d2ee523a2206206994597c13d831ec7",
  "0x6b175474e89094c44da98b954eedeac495271d0f",
]);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function scorePool(pool: EthereumTrendingPool): number {
  const participants = pool.buyers24h + pool.sellers24h;
  const buyerShare = participants > 0 ? pool.buyers24h / participants : 0;
  const sentiment = pool.sentimentPositivePercentage;
  const momentumScore =
    pool.priceChange6h >= 0 && pool.priceChange6h <= 30
      ? 12
      : pool.priceChange6h > 30 && pool.priceChange6h <= 60
        ? 6
        : pool.priceChange6h >= -10
          ? 4
          : 0;

  return Math.round(clamp(
    28 - (pool.rank - 1) * 1.5 +
      clamp(Math.log10(Math.max(pool.liquidityUsd, 1)) - 5, 0, 2) * 10 +
      clamp(Math.log10(Math.max(pool.volume24hUsd, 1)) - 4.5, 0, 2) * 7.5 +
      clamp((buyerShare - 0.4) * 50, 0, 12) +
      (sentiment === null ? 4 : clamp((sentiment - 45) / 5, 0, 10)) +
      momentumScore -
      pool.suspiciousReportCount * 4,
    0,
    100,
  ));
}

function toCandidate(
  pool: EthereumTrendingPool,
  nowMs: number,
  contractSafety: ContractSafetyAssessment,
  quotePreflight: PreflightAssessment,
): TrendCandidate | null {
  if (
    !ETHEREUM_ADDRESS.test(pool.contractAddress) ||
    !ETHEREUM_ADDRESS.test(pool.pairAddress) ||
    pool.priceUsd === null ||
    pool.priceUsd <= 0
  ) {
    return null;
  }

  const createdAtMs = Date.parse(pool.poolCreatedAt);
  const poolAgeDays = Number.isFinite(createdAtMs)
    ? Math.max(0, (nowMs - createdAtMs) / (24 * 60 * 60 * 1_000))
    : 0;
  const participants = pool.buyers24h + pool.sellers24h;
  const buyerShare = participants > 0 ? pool.buyers24h / participants : 0;
  const reasons: string[] = [];
  const failures: string[] = [];

  if (contractSafety.status !== "pass") {
    failures.push(
      `コントラクト${contractSafety.status.toUpperCase()}: ${contractSafety.reasons[0] ?? "安全確認未完了"}`,
    );
  } else {
    reasons.push("コントラクト安全ゲート通過");
  }
  if (quotePreflight.status !== "pass") {
    failures.push(
      `双方向見積${quotePreflight.status.toUpperCase()}: ${quotePreflight.reasons[0] ?? "安全確認未完了"}`,
    );
  } else {
    reasons.push("BUY／SELL双方向見積を確認");
  }

  if (!TRUSTED_QUOTES.has(pool.quoteContractAddress)) failures.push("信頼済み建値ではない");
  if (TRUSTED_QUOTES.has(pool.contractAddress)) failures.push("基軸・安定通貨はローテーション対象外");
  if (pool.liquidityUsd < MIN_LIQUIDITY_USD) failures.push("流動性75万ドル未満");
  else reasons.push("流動性ゲート通過");
  if (pool.volume24hUsd < MIN_VOLUME_24H_USD) failures.push("24H出来高25万ドル未満");
  else reasons.push("出来高ゲート通過");
  if (poolAgeDays < MIN_POOL_AGE_DAYS) failures.push("プール開設30日未満");
  if (pool.suspiciousReportCount > MAX_SUSPICIOUS_REPORTS) failures.push("不審報告が多い");
  if (buyerShare < 0.45) failures.push("24H参加者が売り優勢");
  else reasons.push(`買い参加者比率${Math.round(buyerShare * 100)}%`);
  if (pool.priceChange1h < -12 || pool.priceChange1h > 18) failures.push("1H値動きが過熱域");
  if (pool.priceChange24h < -40 || pool.priceChange24h > 80) failures.push("24H値動きが許容外");
  if (
    pool.sentimentPositivePercentage !== null &&
    pool.sentimentPositivePercentage < 55
  ) {
    failures.push("コミュニティ好感票55%未満");
  } else if (pool.sentimentPositivePercentage !== null) {
    reasons.push(`好感票${pool.sentimentPositivePercentage.toFixed(0)}%`);
  }

  const score = scorePool(pool);
  const decision = failures.length > 0 ? "BLOCK" : score >= 70 ? "PAPER" : "WATCH";

  return {
    rank: pool.rank,
    contractAddress: pool.contractAddress,
    pairAddress: pool.pairAddress,
    name: pool.name,
    symbol: pool.symbol,
    priceUsd: pool.priceUsd,
    liquidityUsd: pool.liquidityUsd,
    volume24hUsd: pool.volume24hUsd,
    priceChange1h: pool.priceChange1h,
    priceChange6h: pool.priceChange6h,
    priceChange24h: pool.priceChange24h,
    buyers24h: pool.buyers24h,
    sellers24h: pool.sellers24h,
    sentimentPositivePercentage: pool.sentimentPositivePercentage,
    suspiciousReportCount: pool.suspiciousReportCount,
    poolAgeDays: round(poolAgeDays, 1),
    score,
    decision,
    reasons: failures.length > 0 ? failures : reasons,
    contractSafety,
    quotePreflight,
  };
}

function sourceAsset(
  snapshot: PortfolioSnapshot,
  candidate: TrendCandidate,
): PortfolioAsset | null {
  return snapshot.assets
    .filter(
      (asset) =>
        asset.tradability === "eligible" &&
        asset.contractAddress !== null &&
        asset.contractAddress.toLowerCase() !== candidate.contractAddress &&
        asset.valueUsd >= MIN_PAPER_ROTATION_USD,
    )
    .toSorted(
      (left, right) =>
        (left.priceChange24h ?? 0) - (right.priceChange24h ?? 0) ||
        right.valueUsd - left.valueUsd,
    )[0] ?? null;
}

function createPaperRotation(
  snapshot: PortfolioSnapshot,
  candidates: TrendCandidate[],
): TrendPaperRotation | null {
  const candidate = candidates.find((item) => item.decision === "PAPER");
  if (!candidate) return null;
  const source = sourceAsset(snapshot, candidate);
  if (!source?.contractAddress) return null;

  const amountUsd = round(Math.min(
    snapshot.totalUsd * (MAX_ROTATION_PERCENT / 100),
    source.valueUsd * (SOURCE_POSITION_PERCENT / 100),
  ));
  if (amountUsd < MIN_PAPER_ROTATION_USD) return null;

  const execution = estimateExecutionCost(amountUsd, candidate.liquidityUsd);
  const estimatedRoundTripCostUsd = execution.estimatedRoundTripCostUsd;
  const expectedGrossProfitUsd = amountUsd * 0.12;

  return {
    fromSymbol: source.symbol,
    fromContractAddress: source.contractAddress.toLowerCase(),
    toSymbol: candidate.symbol,
    toContractAddress: candidate.contractAddress,
    entryPriceUsd: candidate.priceUsd,
    amountUsd,
    allocationPercent: round((amountUsd / snapshot.totalUsd) * 100, 1),
    estimatedRoundTripCostUsd,
    estimatedPriceImpactPercent: execution.estimatedPriceImpactPercent,
    estimatedOneWaySlippagePercent:
      execution.estimatedOneWaySlippagePercent,
    costGatePassed:
      execution.priceImpactGatePassed &&
      expectedGrossProfitUsd >= estimatedRoundTripCostUsd * 1.5,
    score: candidate.score,
    executionLocked: true,
  };
}

export function createTrendScoutSnapshot(
  pools: EthereumTrendingPool[],
  snapshot: PortfolioSnapshot,
  nowMs = Date.now(),
  safetyByAddress: ReadonlyMap<string, ContractSafetyAssessment> = new Map(),
  preflightByAddress: ReadonlyMap<string, PreflightAssessment> = new Map(),
): TrendScoutSnapshot {
  const unique = new Map<string, TrendCandidate>();
  for (const pool of pools) {
    const contractSafety = safetyByAddress.get(pool.contractAddress.toLowerCase()) ?? {
      status: "unavailable" as const,
      source: "blockscout" as const,
      verified: null,
      isContract: null,
      isScam: null,
      isProxy: null,
      implementationAddress: null,
      erc20InterfacePassed: null,
      privilegedFunctions: [],
      reasons: ["コントラクト情報未取得"],
    };
    const quotePreflight = preflightByAddress.get(pool.contractAddress.toLowerCase()) ?? {
      status: "unavailable" as const,
      provider: "kyberswap" as const,
      testAmountUsd: 50,
      buy: null,
      sell: null,
      roundTripRetentionPercent: null,
      roundTripLossPercent: null,
      quoteTtlSeconds: 30 as const,
      reasons: ["双方向見積未取得"],
    };
    const candidate = toCandidate(
      pool,
      nowMs,
      contractSafety,
      quotePreflight,
    );
    if (!candidate) continue;
    const current = unique.get(candidate.contractAddress);
    if (!current || candidate.score > current.score) {
      unique.set(candidate.contractAddress, candidate);
    }
  }

  const candidates = [...unique.values()]
    .toSorted((left, right) => right.score - left.score || left.rank - right.rank)
    .slice(0, MAX_DISPLAY_CANDIDATES);
  const paperCandidateCount = candidates.filter(
    (candidate) => candidate.decision === "PAPER",
  ).length;

  return {
    generatedAt: new Date(nowMs).toISOString(),
    source: "geckoterminal",
    mode: "shadow",
    executionLocked: true,
    candidateCount: candidates.length,
    paperCandidateCount,
    candidates,
    paperRotation: createPaperRotation(snapshot, candidates),
    warnings: [],
  };
}

export function unavailableTrendScoutSnapshot(
  message: string,
  nowMs = Date.now(),
): TrendScoutSnapshot {
  return {
    generatedAt: new Date(nowMs).toISOString(),
    source: "geckoterminal",
    mode: "shadow",
    executionLocked: true,
    candidateCount: 0,
    paperCandidateCount: 0,
    candidates: [],
    paperRotation: null,
    warnings: [message],
  };
}
