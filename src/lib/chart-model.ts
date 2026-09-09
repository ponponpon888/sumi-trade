import {
  ESTIMATED_SLIPPAGE_PERCENT,
  ESTIMATED_SWAP_GAS_USD,
  MAX_POSITION_PERCENT,
  RISK_PER_TRADE_PERCENT,
} from "@/lib/config";
import { estimateExecutionCost } from "@/lib/execution-cost";
import { evaluateTimeframe, normalizeCandles } from "@/lib/indicators";
import { classifyRegime } from "@/lib/regime";
import {
  analyzeStrategyRobustness,
  type RobustnessTrade,
} from "@/lib/strategy-robustness";
import type {
  BacktestResult,
  ChartAnalysis,
  ChartDirection,
  ChartMarketContext,
  ChartRiskPlan,
  MarketRegime,
  OhlcvCandle,
  RegimeAssessment,
  StrategyComparisonId,
  StrategyComparisonSnapshot,
  TimeframeIndicators,
} from "@/lib/types";

const TIMEFRAME_WEIGHTS = new Map([
  ["5m", 1],
  ["15m", 1.25],
  ["1h", 1.5],
]);
const MIN_MODEL_CANDLES = 260;
const BACKTEST_CAPITAL_USD = 1_000;
const WALK_FORWARD_TRAIN_CANDLES = 360;
const WALK_FORWARD_TEST_CANDLES = 120;
const MARKET_REGIME_ORDER: MarketRegime[] = [
  "uptrend",
  "downtrend",
  "range",
  "high-volatility",
  "low-liquidity",
];

type BacktestTrade = RobustnessTrade & {
  netPnlUsd: number;
  netReturnPercent: number;
};

type BacktestState = {
  cash: number;
  units: number;
  invested: number;
  entryCost: number;
  entryEquity: number;
  entrySlippageUsd: number;
  grossProfit: number;
  grossLoss: number;
  wins: number;
  trades: number;
};

type SimulationResult = Omit<
  BacktestResult,
  "executionModel" | "candleCount" | "walkForward" | "robustness"
> & { robustnessTrades: RobustnessTrade[] };

interface BacktestStrategyDecision {
  direction: ChartDirection;
  riskMultiplier: number;
  atrPercent: number;
}

type BacktestStrategyEvaluator = (
  history: OhlcvCandle[],
  marketContext: ChartMarketContext,
) => BacktestStrategyDecision;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function computeScore(timeframes: TimeframeIndicators[]): number {
  let score = 50;

  for (const indicators of timeframes) {
    const weight = TIMEFRAME_WEIGHTS.get(indicators.timeframe) ?? 1;
    if (indicators.trend === "bullish") score += 8 * weight;
    if (indicators.trend === "bearish") score -= 8 * weight;

    if (
      indicators.close !== null &&
      indicators.emaSlow !== null
    ) {
      score += indicators.close >= indicators.emaSlow ? 2 * weight : -2 * weight;
    }

    if (indicators.rsi14 !== null) {
      if (indicators.rsi14 >= 52 && indicators.rsi14 <= 68) score += 3 * weight;
      if (indicators.rsi14 >= 32 && indicators.rsi14 <= 48) score -= 3 * weight;
      if (indicators.rsi14 >= 75) score -= 4 * weight;
      if (indicators.rsi14 <= 25) score += 4 * weight;
    }

    if ((indicators.volumeRatio ?? 0) >= 1.2) {
      if (indicators.trend === "bullish") score += 2 * weight;
      if (indicators.trend === "bearish") score -= 2 * weight;
    }
  }

  return round(clamp(score, 0, 100), 1);
}

function decideDirection(
  score: number,
  timeframes: TimeframeIndicators[],
  regime: RegimeAssessment,
): ChartDirection {
  const byTimeframe = new Map(
    timeframes.map((indicators) => [indicators.timeframe, indicators]),
  );
  const fiveMinute = byTimeframe.get("5m");
  const fifteenMinute = byTimeframe.get("15m");
  const oneHour = byTimeframe.get("1h");

  if (
    regime.regime === "high-volatility" ||
    regime.regime === "low-liquidity"
  ) {
    return "HOLD";
  }

  if (
    regime.regime === "uptrend" &&
    score >= 68 &&
    oneHour?.trend === "bullish" &&
    fifteenMinute?.trend === "bullish" &&
    (fiveMinute?.rsi14 ?? 100) < 72
  ) {
    return "BUY";
  }

  if (
    regime.regime === "downtrend" &&
    score <= 32 &&
    oneHour?.trend === "bearish" &&
    fifteenMinute?.trend === "bearish" &&
    (fiveMinute?.rsi14 ?? 0) > 28
  ) {
    return "SELL";
  }

  if (
    regime.regime === "range" &&
    (fiveMinute?.rsi14 ?? 100) <= 28 &&
    (fifteenMinute?.rsi14 ?? 100) <= 42 &&
    (fiveMinute?.volumeRatio ?? 0) >= 0.8
  ) {
    return "BUY";
  }

  if (
    regime.regime === "range" &&
    (fiveMinute?.rsi14 ?? 0) >= 72 &&
    (fifteenMinute?.rsi14 ?? 0) >= 58
  ) {
    return "SELL";
  }

  return "HOLD";
}

function explainModel(
  direction: ChartDirection,
  score: number,
  timeframes: TimeframeIndicators[],
  regime: RegimeAssessment,
): { summary: string; reasons: string[] } {
  const bullish = timeframes.filter((item) => item.trend === "bullish").length;
  const bearish = timeframes.filter((item) => item.trend === "bearish").length;
  const fiveMinute = timeframes.find((item) => item.timeframe === "5m");
  const reasons = [
    `局面 ${regime.regime} / ${regime.strategy}`,
    `3時間軸のうち上昇 ${bullish} / 下降 ${bearish}`,
    `複合スコア ${score} / 100`,
  ];

  if (fiveMinute?.rsi14 !== null && fiveMinute?.rsi14 !== undefined) {
    reasons.push(`5分足 RSI ${round(fiveMinute.rsi14, 1)}`);
  }
  if (
    fiveMinute?.volumeRatio !== null &&
    fiveMinute?.volumeRatio !== undefined
  ) {
    reasons.push(`出来高倍率 ${round(fiveMinute.volumeRatio, 2)}x`);
  }

  const summary =
    regime.regime === "low-liquidity"
      ? "流動性がRegime基準未満のため、新規注文を停止します。"
      : regime.regime === "high-volatility"
        ? "値動きが急激なため、リスクオフで待機します。"
        : direction === "BUY"
          ? regime.regime === "range"
            ? "レンジ下限の平均回帰を小さく紙上評価します。"
            : "上位足と短期足が上向き。順張りの買い候補です。"
          : direction === "SELL"
            ? regime.regime === "range"
              ? "レンジ上限の過熱を検出。縮小候補です。"
              : "上位足と短期足が下向き。資産保全を優先します。"
            : "現在の市場局面に有効な条件が揃うまで待機します。";

  return { summary, reasons };
}

function calculateSnapshot(
  candles: OhlcvCandle[],
  marketContext: ChartMarketContext = {
    liquidityUsd: null,
    volume24hUsd: null,
  },
): {
  timeframes: TimeframeIndicators[];
  score: number;
  direction: ChartDirection;
  regime: RegimeAssessment;
  summary: string;
  reasons: string[];
} {
  const timeframes = [
    evaluateTimeframe(candles, "5m"),
    evaluateTimeframe(candles, "15m"),
    evaluateTimeframe(candles, "1h"),
  ];
  const score = computeScore(timeframes);
  const regime = classifyRegime(timeframes, marketContext);
  const direction = decideDirection(score, timeframes, regime);
  const explanation = explainModel(direction, score, timeframes, regime);
  return { timeframes, score, direction, regime, ...explanation };
}

function sumiRegimeDecision(
  history: OhlcvCandle[],
  marketContext: ChartMarketContext,
): BacktestStrategyDecision {
  const model = calculateSnapshot(history, marketContext);
  return {
    direction: model.direction,
    riskMultiplier: model.regime.riskMultiplier,
    atrPercent:
      model.timeframes.find((item) => item.timeframe === "15m")?.atrPercent ??
      model.timeframes[0]?.atrPercent ??
      3,
  };
}

function emaTrendDecision(history: OhlcvCandle[]): BacktestStrategyDecision {
  const indicators = evaluateTimeframe(history, "15m");
  const direction =
    indicators.emaFast !== null &&
    indicators.emaSlow !== null &&
    indicators.close !== null
      ? indicators.emaFast > indicators.emaSlow && indicators.close > indicators.emaFast
        ? "BUY"
        : indicators.emaFast < indicators.emaSlow && indicators.close < indicators.emaFast
          ? "SELL"
          : "HOLD"
      : "HOLD";
  return {
    direction,
    riskMultiplier: 1,
    atrPercent: indicators.atrPercent ?? 3,
  };
}

function rsiReversionDecision(history: OhlcvCandle[]): BacktestStrategyDecision {
  const fiveMinute = evaluateTimeframe(history, "5m");
  const fifteenMinute = evaluateTimeframe(history, "15m");
  const rsi = fiveMinute.rsi14;
  return {
    direction: rsi === null ? "HOLD" : rsi <= 30 ? "BUY" : rsi >= 70 ? "SELL" : "HOLD",
    riskMultiplier: 0.5,
    atrPercent: fifteenMinute.atrPercent ?? fiveMinute.atrPercent ?? 3,
  };
}

export function createRiskPlan(
  portfolioTotalUsd: number,
  atrPercent: number,
  riskMultiplier = 1,
  liquidityUsd: number | null = null,
): ChartRiskPlan {
  const stopLossPercent = clamp(atrPercent * 1.8, 2, 8);
  const takeProfitPercent = clamp(stopLossPercent * 2, 6, 18);
  const trailingStopPercent = clamp(atrPercent * 1.2, 1.5, 6);
  const riskSizedPosition = (RISK_PER_TRADE_PERCENT / stopLossPercent) * 100;
  const basePositionSizePercent = clamp(
    riskSizedPosition,
    3,
    MAX_POSITION_PERCENT,
  );
  const positionSizePercent = clamp(
    basePositionSizePercent * riskMultiplier,
    0,
    MAX_POSITION_PERCENT,
  );
  const positionUsd = portfolioTotalUsd * (positionSizePercent / 100);
  const execution = estimateExecutionCost(positionUsd, liquidityUsd);
  const estimatedRoundTripCostUsd = execution.estimatedRoundTripCostUsd;
  const expectedGrossProfitUsd = positionUsd * (takeProfitPercent / 100);

  return {
    stopLossPercent: round(stopLossPercent, 1),
    takeProfitPercent: round(takeProfitPercent, 1),
    trailingStopPercent: round(trailingStopPercent, 1),
    positionSizePercent: round(positionSizePercent, 1),
    estimatedRoundTripCostUsd: round(estimatedRoundTripCostUsd),
    expectedGrossProfitUsd: round(expectedGrossProfitUsd),
    costGatePassed:
      positionUsd >= 20 &&
      execution.priceImpactGatePassed &&
      expectedGrossProfitUsd >= estimatedRoundTripCostUsd * 1.5,
    execution,
  };
}

function closeBacktestPosition(
  state: BacktestState,
  exitPrice: number,
  trades: BacktestTrade[],
): void {
  const grossProceeds = state.units * exitPrice;
  const exitCost =
    ESTIMATED_SWAP_GAS_USD +
    grossProceeds * (ESTIMATED_SLIPPAGE_PERCENT / 100);
  const netProceeds = grossProceeds - exitCost;
  const profit = netProceeds - state.invested - state.entryCost;
  const committedCapital = state.invested + state.entryCost;

  state.cash += netProceeds;
  state.trades += 1;
  if (profit > 0) {
    state.wins += 1;
    state.grossProfit += profit;
  } else {
    state.grossLoss += Math.abs(profit);
  }
  trades.push({
    netPnlUsd: profit,
    netReturnPercent:
      committedCapital > 0 ? (profit / committedCapital) * 100 : 0,
    equityBeforeTrade: state.entryEquity,
    gasCostUsd: state.entryCost + ESTIMATED_SWAP_GAS_USD,
    slippageCostUsd:
      state.entrySlippageUsd +
      grossProceeds * (ESTIMATED_SLIPPAGE_PERCENT / 100),
  });
  state.units = 0;
  state.invested = 0;
  state.entryCost = 0;
  state.entryEquity = 0;
  state.entrySlippageUsd = 0;
}

function riskAdjustedRatio(
  returns: number[],
  downsideOnly = false,
): number | null {
  if (returns.length < 2) return null;
  const mean = returns.reduce((total, value) => total + value, 0) / returns.length;
  const sample = downsideOnly ? returns.filter((value) => value < 0) : returns;
  if (sample.length < 2) return null;
  const variance = sample.reduce(
    (total, value) => total + (value - (downsideOnly ? 0 : mean)) ** 2,
    0,
  ) / (sample.length - 1);
  const deviation = Math.sqrt(variance);
  if (!Number.isFinite(deviation) || deviation === 0) return null;
  return round((mean / deviation) * Math.sqrt(returns.length), 2);
}

function costAdjustedBenchmark(startPrice: number, endPrice: number): number {
  const available = Math.max(0, BACKTEST_CAPITAL_USD - ESTIMATED_SWAP_GAS_USD);
  const entryPrice = startPrice * (1 + ESTIMATED_SLIPPAGE_PERCENT / 100);
  const units = entryPrice > 0 ? available / entryPrice : 0;
  const grossProceeds = units * endPrice;
  const finalCash =
    grossProceeds -
    ESTIMATED_SWAP_GAS_USD -
    grossProceeds * (ESTIMATED_SLIPPAGE_PERCENT / 100);
  return ((finalCash - BACKTEST_CAPITAL_USD) / BACKTEST_CAPITAL_USD) * 100;
}

function runSimulation(
  candles: OhlcvCandle[],
  tradeStartIndex: number,
  tradeEndIndex: number,
  marketContext: ChartMarketContext,
  evaluateStrategy: BacktestStrategyEvaluator,
): SimulationResult {
  const state: BacktestState = {
    cash: BACKTEST_CAPITAL_USD,
    units: 0,
    invested: 0,
    entryCost: 0,
    entryEquity: 0,
    entrySlippageUsd: 0,
    grossProfit: 0,
    grossLoss: 0,
    wins: 0,
    trades: 0,
  };
  const trades: BacktestTrade[] = [];
  let entryPrice = 0;
  let highestPrice = 0;
  let stopLossPercent = 0;
  let takeProfitPercent = 0;
  let trailingStopPercent = 0;
  let equityPeak = BACKTEST_CAPITAL_USD;
  let maxDrawdownPercent = 0;

  let pendingEntryRisk: ChartRiskPlan | null = null;
  let pendingExit = false;

  for (let index = tradeStartIndex; index < tradeEndIndex; index += 1) {
    const history = candles.slice(0, index + 1);
    const current = history.at(-1);
    if (!current) continue;

    // A signal becomes knowable only after its candle closes. Execute it at
    // the next candle open so the backtest cannot buy or sell in the past.
    if (pendingExit && state.units > 0) {
      closeBacktestPosition(state, current.open, trades);
    }
    pendingExit = false;

    if (pendingEntryRisk && state.units === 0) {
      const available = Math.max(0, state.cash - ESTIMATED_SWAP_GAS_USD);
      const requested =
        state.cash * (pendingEntryRisk.positionSizePercent / 100);
      const invested = Math.min(requested, available);
      if (invested >= 20) {
        state.entryEquity = state.cash;
        entryPrice = current.open * (1 + ESTIMATED_SLIPPAGE_PERCENT / 100);
        state.units = invested / entryPrice;
        state.invested = invested;
        state.entryCost = ESTIMATED_SWAP_GAS_USD;
        state.entrySlippageUsd =
          invested * (ESTIMATED_SLIPPAGE_PERCENT / 100);
        state.cash -= invested + state.entryCost;
        highestPrice = current.open;
        stopLossPercent = pendingEntryRisk.stopLossPercent;
        takeProfitPercent = pendingEntryRisk.takeProfitPercent;
        trailingStopPercent = pendingEntryRisk.trailingStopPercent;
      }
    }
    pendingEntryRisk = null;

    if (state.units > 0) {
      highestPrice = Math.max(highestPrice, current.high);
      const hardStop = entryPrice * (1 - stopLossPercent / 100);
      const trailingStop = highestPrice * (1 - trailingStopPercent / 100);
      const stopPrice = Math.max(hardStop, trailingStop);
      const takeProfit = entryPrice * (1 + takeProfitPercent / 100);

      // OHLCV does not reveal which level was touched first. If both are
      // possible inside one candle, the stop wins to avoid optimistic results.
      if (current.low <= stopPrice) {
        closeBacktestPosition(state, stopPrice, trades);
      } else if (current.high >= takeProfit) {
        closeBacktestPosition(state, takeProfit, trades);
      }
    }

    const equity = state.cash + state.units * current.close;
    equityPeak = Math.max(equityPeak, equity);
    maxDrawdownPercent = Math.max(
      maxDrawdownPercent,
      equityPeak > 0 ? ((equityPeak - equity) / equityPeak) * 100 : 0,
    );

    const decision = evaluateStrategy(history, marketContext);
    if (state.units === 0 && decision.direction === "BUY") {
      pendingEntryRisk = createRiskPlan(
        equity,
        decision.atrPercent,
        decision.riskMultiplier,
      );
    } else if (state.units > 0 && decision.direction === "SELL") {
      pendingExit = true;
    }
  }

  const finalCandle = candles[tradeEndIndex - 1];
  if (state.units > 0 && finalCandle) {
    closeBacktestPosition(state, finalCandle.close, trades);
    equityPeak = Math.max(equityPeak, state.cash);
    maxDrawdownPercent = Math.max(
      maxDrawdownPercent,
      equityPeak > 0 ? ((equityPeak - state.cash) / equityPeak) * 100 : 0,
    );
  }

  const netReturnPercent =
    ((state.cash - BACKTEST_CAPITAL_USD) / BACKTEST_CAPITAL_USD) * 100;
  const profitFactor =
    state.grossLoss > 0
      ? state.grossProfit / state.grossLoss
      : state.grossProfit > 0
        ? null
        : 0;
  const benchmarkReturnPercent =
    candles[tradeStartIndex] && finalCandle
      ? costAdjustedBenchmark(candles[tradeStartIndex].open, finalCandle.close)
      : 0;
  const tradeReturns = trades.map((trade) => trade.netReturnPercent);
  const expectancyPercent =
    tradeReturns.length > 0
      ? tradeReturns.reduce((total, value) => total + value, 0) /
        tradeReturns.length
      : 0;

  return {
    status: state.trades > 0 ? "ready" : "no-trades",
    tradeCount: state.trades,
    winRate: state.trades > 0 ? round((state.wins / state.trades) * 100, 1) : 0,
    netReturnPercent: round(netReturnPercent, 2),
    benchmarkReturnPercent: round(benchmarkReturnPercent, 2),
    excessReturnPercent: round(netReturnPercent - benchmarkReturnPercent, 2),
    expectancyPercent: round(expectancyPercent, 2),
    maxDrawdownPercent: round(maxDrawdownPercent, 2),
    profitFactor: profitFactor === null ? null : round(profitFactor, 2),
    tradeSharpeRatio: riskAdjustedRatio(tradeReturns),
    tradeSortinoRatio: riskAdjustedRatio(tradeReturns, true),
    robustnessTrades: trades,
  };
}

function runWalkForward(
  candles: OhlcvCandle[],
  marketContext: ChartMarketContext,
  evaluateStrategy: BacktestStrategyEvaluator,
): BacktestResult["walkForward"] {
  const windows: SimulationResult[] = [];
  for (
    let testStart = WALK_FORWARD_TRAIN_CANDLES;
    testStart + WALK_FORWARD_TEST_CANDLES <= candles.length;
    testStart += WALK_FORWARD_TEST_CANDLES
  ) {
    windows.push(
      runSimulation(
        candles,
        testStart,
        testStart + WALK_FORWARD_TEST_CANDLES,
        marketContext,
        evaluateStrategy,
      ),
    );
  }

  if (windows.length === 0) {
    return {
      status: "insufficient",
      windowCount: 0,
      profitableWindowRate: 0,
      tradeCount: 0,
      netReturnPercent: 0,
      maxDrawdownPercent: 0,
    };
  }

  const compounded = windows.reduce(
    (capital, window) => capital * (1 + window.netReturnPercent / 100),
    BACKTEST_CAPITAL_USD,
  );
  const tradeCount = windows.reduce(
    (total, window) => total + window.tradeCount,
    0,
  );
  const profitableWindows = windows.filter(
    (window) => window.netReturnPercent > 0,
  ).length;

  return {
    status: tradeCount > 0 ? "ready" : "no-trades",
    windowCount: windows.length,
    profitableWindowRate: round((profitableWindows / windows.length) * 100, 1),
    tradeCount,
    netReturnPercent: round(
      ((compounded - BACKTEST_CAPITAL_USD) / BACKTEST_CAPITAL_USD) * 100,
      2,
    ),
    maxDrawdownPercent: round(
      Math.max(...windows.map((window) => window.maxDrawdownPercent)),
      2,
    ),
  };
}

function insufficientBacktest(candleCount: number): BacktestResult {
  return {
    status: "insufficient",
    executionModel: "next-open-conservative",
    candleCount,
    tradeCount: 0,
    winRate: 0,
    netReturnPercent: 0,
    benchmarkReturnPercent: 0,
    excessReturnPercent: 0,
    expectancyPercent: 0,
    maxDrawdownPercent: 0,
    profitFactor: null,
    tradeSharpeRatio: null,
    tradeSortinoRatio: null,
    robustness: analyzeStrategyRobustness([]),
    walkForward: {
      status: "insufficient",
      windowCount: 0,
      profitableWindowRate: 0,
      tradeCount: 0,
      netReturnPercent: 0,
      maxDrawdownPercent: 0,
    },
  };
}

function runStrategyBacktest(
  candles: OhlcvCandle[],
  marketContext: ChartMarketContext,
  evaluateStrategy: BacktestStrategyEvaluator,
): BacktestResult {
  if (candles.length < MIN_MODEL_CANDLES) {
    return insufficientBacktest(candles.length);
  }

  const { robustnessTrades, ...simulation } = runSimulation(
    candles,
    MIN_MODEL_CANDLES,
    candles.length,
    marketContext,
    evaluateStrategy,
  );
  return {
    ...simulation,
    executionModel: "next-open-conservative",
    candleCount: candles.length,
    robustness: analyzeStrategyRobustness(robustnessTrades),
    walkForward: runWalkForward(candles, marketContext, evaluateStrategy),
  };
}

export function runBacktest(
  candles: OhlcvCandle[],
  marketContext: ChartMarketContext = {
    liquidityUsd: null,
    volume24hUsd: null,
  },
): BacktestResult {
  return runStrategyBacktest(candles, marketContext, sumiRegimeDecision);
}

const STRATEGY_DEFINITIONS: Array<{
  id: StrategyComparisonId;
  name: string;
  family: "regime" | "trend" | "mean-reversion";
  evaluate: BacktestStrategyEvaluator;
}> = [
  {
    id: "sumi-regime",
    name: "SUMI REGIME",
    family: "regime",
    evaluate: sumiRegimeDecision,
  },
  {
    id: "ema-trend",
    name: "EMA 9/21 TREND",
    family: "trend",
    evaluate: emaTrendDecision,
  },
  {
    id: "rsi-reversion",
    name: "RSI 30/70 REVERSION",
    family: "mean-reversion",
    evaluate: rsiReversionDecision,
  },
];

function compareStrategiesByRegime(
  candles: OhlcvCandle[],
  marketContext: ChartMarketContext,
): StrategyComparisonSnapshot["walkForwardByRegime"] {
  const windows: Array<{
    regime: MarketRegime;
    simulations: Map<StrategyComparisonId, SimulationResult>;
  }> = [];

  for (
    let testStart = WALK_FORWARD_TRAIN_CANDLES;
    testStart + WALK_FORWARD_TEST_CANDLES <= candles.length;
    testStart += WALK_FORWARD_TEST_CANDLES
  ) {
    const regime = calculateSnapshot(
      candles.slice(0, testStart),
      marketContext,
    ).regime.regime;
    windows.push({
      regime,
      simulations: new Map(
        STRATEGY_DEFINITIONS.map((definition) => [
          definition.id,
          runSimulation(
            candles,
            testStart,
            testStart + WALK_FORWARD_TEST_CANDLES,
            marketContext,
            definition.evaluate,
          ),
        ]),
      ),
    });
  }

  return MARKET_REGIME_ORDER.flatMap((regime) => {
    const regimeWindows = windows.filter((window) => window.regime === regime);
    if (regimeWindows.length === 0) return [];

    const ranked = STRATEGY_DEFINITIONS.map((definition) => {
      const simulations = regimeWindows.flatMap((window) => {
        const simulation = window.simulations.get(definition.id);
        return simulation ? [simulation] : [];
      });
      const compounded = simulations.reduce(
        (capital, simulation) =>
          capital * (1 + simulation.netReturnPercent / 100),
        BACKTEST_CAPITAL_USD,
      );
      return {
        id: definition.id,
        name: definition.name,
        windowCount: simulations.length,
        tradeCount: simulations.reduce(
          (total, simulation) => total + simulation.tradeCount,
          0,
        ),
        profitableWindowRate: round(
          (simulations.filter((simulation) => simulation.netReturnPercent > 0)
            .length /
            simulations.length) *
            100,
          1,
        ),
        netReturnPercent: round(
          ((compounded - BACKTEST_CAPITAL_USD) / BACKTEST_CAPITAL_USD) * 100,
          2,
        ),
      };
    })
      .toSorted(
        (left, right) =>
          right.netReturnPercent - left.netReturnPercent ||
          left.id.localeCompare(right.id),
      )
      .map((result, index) => ({ ...result, rank: index + 1 }));

    return [
      {
        regime,
        windowCount: regimeWindows.length,
        leaderId: ranked[0]?.id ?? null,
        researchOnly: true as const,
        results: ranked,
      },
    ];
  });
}

export function compareStrategies(
  candles: OhlcvCandle[],
  existingSumiBacktest?: BacktestResult,
): StrategyComparisonSnapshot {
  if (candles.length < MIN_MODEL_CANDLES) {
    return {
      status: "insufficient",
      candleCount: candles.length,
      benchmarkReturnPercent: 0,
      leaderId: null,
      researchOnly: true,
      results: [],
      walkForwardByRegime: [],
      notes: [`比較には${MIN_MODEL_CANDLES}本以上の確定足が必要`],
    };
  }

  const marketContext = { liquidityUsd: null, volume24hUsd: null };
  const sumiBacktest =
    existingSumiBacktest ??
    runStrategyBacktest(candles, marketContext, sumiRegimeDecision);
  const measured = STRATEGY_DEFINITIONS.map((definition) => {
    const backtest =
      definition.id === "sumi-regime"
        ? sumiBacktest
        : runStrategyBacktest(candles, marketContext, definition.evaluate);
    return {
      id: definition.id,
      name: definition.name,
      family: definition.family,
      status: backtest.status,
      executionModel: backtest.executionModel,
      tradeCount: backtest.tradeCount,
      netReturnPercent: backtest.netReturnPercent,
      outOfSampleReturnPercent:
        backtest.walkForward.status === "ready"
          ? backtest.walkForward.netReturnPercent
          : backtest.netReturnPercent,
      maxDrawdownPercent: backtest.maxDrawdownPercent,
      profitFactor: backtest.profitFactor,
      excessReturnPercent: backtest.excessReturnPercent,
    };
  });
  const ranked = measured
    .toSorted(
      (left, right) =>
        right.outOfSampleReturnPercent - left.outOfSampleReturnPercent ||
        left.maxDrawdownPercent - right.maxDrawdownPercent ||
        left.id.localeCompare(right.id),
    )
    .map((result, index) => ({ ...result, rank: index + 1 }));

  return {
    status: "ready",
    candleCount: candles.length,
    benchmarkReturnPercent: sumiBacktest.benchmarkReturnPercent,
    leaderId: ranked[0]?.id ?? null,
    researchOnly: true,
    results: ranked,
    walkForwardByRegime: compareStrategiesByRegime(candles, marketContext),
    notes: [
      "全戦略を同じ確定足・次足始値・ガス・スリッページ条件で比較",
      "各10時間テスト窓を開始時点までの情報で局面分類",
      "首位戦略への自動切替は行わず、研究表示だけに使用",
    ],
  };
}

export function createUnavailableChartAnalysis(
  symbol: string,
  summary: string,
): ChartAnalysis {
  return {
    symbol,
    status: "unavailable",
    direction: "HOLD",
    score: 50,
    confidence: 0,
    summary,
    reasons: ["履歴データが取得できないため、新規注文を禁止"],
    lastPrice: null,
    sparkline: [],
    correlationSeries: [],
    timeframes: [],
    regime: null,
    risk: null,
    backtest: insufficientBacktest(0),
    strategyComparison: compareStrategies([]),
  };
}

export const MAX_CHART_DATA_AGE_SECONDS = 15 * 60;

export function analyzeChart(
  symbol: string,
  rawCandles: OhlcvCandle[],
  portfolioTotalUsd: number,
  nowSeconds = Math.floor(Date.now() / 1_000),
  marketContext: ChartMarketContext = {
    liquidityUsd: null,
    volume24hUsd: null,
  },
): ChartAnalysis {
  const candles = normalizeCandles(rawCandles, 5 * 60, nowSeconds);
  const latestCandle = candles.at(-1);
  const dataAgeSeconds = latestCandle
    ? nowSeconds - (latestCandle.timestamp + 5 * 60)
    : Number.POSITIVE_INFINITY;
  if (latestCandle && dataAgeSeconds > MAX_CHART_DATA_AGE_SECONDS) {
    return {
      ...createUnavailableChartAnalysis(symbol, "最新の確定足が古いため判定を停止しました。"),
      lastPrice: latestCandle.close,
      sparkline: candles.slice(-48).map((candle) => candle.close),
      correlationSeries: candles.slice(-48).map((candle) => ({
        timestamp: candle.timestamp,
        price: candle.close,
      })),
      backtest: runBacktest(candles),
      strategyComparison: compareStrategies(candles),
      reasons: [`最終確定足が${Math.floor(dataAgeSeconds / 60)}分遅延（上限15分）`],
    };
  }
  if (candles.length < MIN_MODEL_CANDLES) {
    return {
      ...createUnavailableChartAnalysis(symbol, "判定に必要なローソク足が不足しています。"),
      status: "insufficient",
      lastPrice: candles.at(-1)?.close ?? null,
      sparkline: candles.slice(-48).map((candle) => candle.close),
      correlationSeries: candles.slice(-48).map((candle) => ({
        timestamp: candle.timestamp,
        price: candle.close,
      })),
      // Historical liquidity snapshots are not available. Do not project the
      // current pool state backward into the backtest.
      backtest: runBacktest(candles),
      strategyComparison: compareStrategies(candles),
      reasons: [`必要 ${MIN_MODEL_CANDLES}本 / 取得 ${candles.length}本`],
    };
  }

  const model = calculateSnapshot(candles, marketContext);
  const atrPercent =
    model.timeframes.find((item) => item.timeframe === "15m")?.atrPercent ??
    model.timeframes[0]?.atrPercent ??
    3;
  const risk = createRiskPlan(
    portfolioTotalUsd,
    atrPercent ?? 3,
    model.regime.riskMultiplier,
    marketContext.liquidityUsd,
  );

  const backtest = runBacktest(candles);
  return {
    symbol,
    status: "ready",
    direction: model.direction,
    score: model.score,
    confidence: round(Math.abs(model.score - 50) * 2, 1),
    summary: model.summary,
    reasons: model.reasons,
    lastPrice: candles.at(-1)?.close ?? null,
    sparkline: candles.slice(-48).map((candle) => candle.close),
    correlationSeries: candles.slice(-48).map((candle) => ({
      timestamp: candle.timestamp,
      price: candle.close,
    })),
    timeframes: model.timeframes,
    regime: model.regime,
    risk,
    // Regime classification for the live decision may use today's liquidity,
    // while the historical simulation remains price/volume-only.
    backtest,
    strategyComparison: compareStrategies(candles, backtest),
  };
}
