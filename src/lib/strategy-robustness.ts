import type { BacktestResult } from "@/lib/types";

export interface RobustnessTrade {
  netPnlUsd: number;
  equityBeforeTrade: number;
  gasCostUsd: number;
  slippageCostUsd: number;
}

const STARTING_CAPITAL_USD = 1_000;
const SIMULATION_COUNT = 1_000;
const MINIMUM_TRADES = 5;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * fraction)),
  );
  return sorted[index] ?? 0;
}

function seedFromTrades(trades: RobustnessTrade[]): number {
  return trades.reduce((seed, trade, index) => {
    const value = Math.round((trade.netPnlUsd + trade.equityBeforeTrade) * 100);
    return (Math.imul(seed ^ value, 16_777_619) + index) >>> 0;
  }, 2_166_136_261);
}

function randomGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function tradeReturn(trade: RobustnessTrade, costMultiplier = 1): number {
  const incrementalCost =
    (trade.gasCostUsd + trade.slippageCostUsd) * (costMultiplier - 1);
  return trade.equityBeforeTrade > 0
    ? (trade.netPnlUsd - incrementalCost) / trade.equityBeforeTrade
    : 0;
}

function runPath(returns: number[]): {
  finalReturnPercent: number;
  maxDrawdownPercent: number;
  ruined: boolean;
} {
  let equity = STARTING_CAPITAL_USD;
  let peak = equity;
  let maxDrawdownPercent = 0;
  let ruined = false;

  for (const value of returns) {
    equity = Math.max(0, equity * (1 + value));
    peak = Math.max(peak, equity);
    maxDrawdownPercent = Math.max(
      maxDrawdownPercent,
      peak > 0 ? ((peak - equity) / peak) * 100 : 100,
    );
    if (equity <= STARTING_CAPITAL_USD * 0.5) ruined = true;
  }

  return {
    finalReturnPercent:
      ((equity - STARTING_CAPITAL_USD) / STARTING_CAPITAL_USD) * 100,
    maxDrawdownPercent,
    ruined,
  };
}

function insufficientRobustness(
  tradeCount: number,
): BacktestResult["robustness"] {
  return {
    status: "insufficient",
    simulationCount: 0,
    tradeCount,
    profitablePathRate: 0,
    medianReturnPercent: 0,
    fifthPercentileReturnPercent: 0,
    ninetyFifthPercentileDrawdownPercent: 0,
    riskOfRuinPercent: 0,
    costSensitivity: [1, 1.5, 2].map((multiplier) => ({
      multiplier: multiplier as 1 | 1.5 | 2,
      netReturnPercent: 0,
    })),
    reasons: [`耐久試験には最低${MINIMUM_TRADES}取引が必要`],
  };
}

export function analyzeStrategyRobustness(
  trades: RobustnessTrade[],
): BacktestResult["robustness"] {
  if (trades.length < MINIMUM_TRADES) {
    return insufficientRobustness(trades.length);
  }

  const random = randomGenerator(seedFromTrades(trades));
  const baseReturns = trades.map((trade) => tradeReturn(trade));
  const outcomes = Array.from({ length: SIMULATION_COUNT }, () => {
    const sampled = Array.from(
      { length: trades.length },
      () => baseReturns[Math.floor(random() * baseReturns.length)] ?? 0,
    );
    return runPath(sampled);
  });
  const returns = outcomes
    .map((outcome) => outcome.finalReturnPercent)
    .toSorted((left, right) => left - right);
  const drawdowns = outcomes
    .map((outcome) => outcome.maxDrawdownPercent)
    .toSorted((left, right) => left - right);
  const profitablePathRate =
    (outcomes.filter((outcome) => outcome.finalReturnPercent > 0).length /
      SIMULATION_COUNT) *
    100;
  const riskOfRuinPercent =
    (outcomes.filter((outcome) => outcome.ruined).length / SIMULATION_COUNT) *
    100;
  const costSensitivity = ([1, 1.5, 2] as const).map((multiplier) => ({
    multiplier,
    netReturnPercent: round(
      runPath(trades.map((trade) => tradeReturn(trade, multiplier)))
        .finalReturnPercent,
    ),
  }));
  const fifthPercentileReturnPercent = percentile(returns, 0.05);
  const doubledCostReturn = costSensitivity.at(-1)?.netReturnPercent ?? 0;
  const reasons: string[] = [];

  if (profitablePathRate < 60) reasons.push("利益経路率が60%未満");
  if (fifthPercentileReturnPercent < -10) {
    reasons.push("下位5%経路の損失が10%超");
  }
  if (riskOfRuinPercent > 1) reasons.push("資産50%割れ確率が1%超");
  if (doubledCostReturn <= 0) reasons.push("コスト2倍で期待収益が消失");
  const passed = reasons.length === 0;
  if (passed) reasons.push("再標本化とコスト2倍ストレスを通過");

  return {
    status: passed ? "pass" : "review",
    simulationCount: SIMULATION_COUNT,
    tradeCount: trades.length,
    profitablePathRate: round(profitablePathRate, 1),
    medianReturnPercent: round(percentile(returns, 0.5)),
    fifthPercentileReturnPercent: round(fifthPercentileReturnPercent),
    ninetyFifthPercentileDrawdownPercent: round(percentile(drawdowns, 0.95)),
    riskOfRuinPercent: round(riskOfRuinPercent, 1),
    costSensitivity,
    reasons,
  };
}
