export type Tradability = "eligible" | "thin" | "blocked" | "gas";
export type SignalAction = "BUY" | "SELL" | "HOLD" | "BLOCK";
export type ChartDirection = "BUY" | "SELL" | "HOLD";
export type ChartStatus = "ready" | "insufficient" | "unavailable";
export type TrendDirection = "bullish" | "neutral" | "bearish";
export type Timeframe = "5m" | "15m" | "1h";
export type MarketRegime =
  | "uptrend"
  | "downtrend"
  | "range"
  | "high-volatility"
  | "low-liquidity";
export type RegimeStrategy =
  | "trend-following"
  | "mean-reversion"
  | "capital-preservation"
  | "risk-off"
  | "blocked";
export type ContractSafetyStatus =
  | "pass"
  | "review"
  | "blocked"
  | "unavailable";

export interface ContractSafetyAssessment {
  status: ContractSafetyStatus;
  source: "blockscout";
  verified: boolean | null;
  isContract: boolean | null;
  isScam: boolean | null;
  isProxy: boolean | null;
  implementationAddress: string | null;
  erc20InterfacePassed: boolean | null;
  privilegedFunctions: string[];
  reasons: string[];
}

export interface PreflightRoute {
  amountIn: string;
  amountOut: string;
  amountInUsd: number;
  amountOutUsd: number;
  gasUsd: number;
  exchanges: string[];
  hopCount: number;
  quotedAt: string;
}

export interface PreflightAssessment {
  status: "pass" | "blocked" | "unavailable";
  provider: "kyberswap";
  testAmountUsd: number;
  buy: PreflightRoute | null;
  sell: PreflightRoute | null;
  roundTripRetentionPercent: number | null;
  roundTripLossPercent: number | null;
  quoteTtlSeconds: 30;
  reasons: string[];
  /** Set only when status is "unavailable" because the quote request itself failed. */
  failureKind?: DataSourceFailureKind;
}

export interface ChartMarketContext {
  liquidityUsd: number | null;
  volume24hUsd: number | null;
}

export interface RegimeAssessment {
  regime: MarketRegime;
  strategy: RegimeStrategy;
  confidence: number;
  riskMultiplier: number;
  reasons: string[];
}

export interface ExecutionCostEstimate {
  mode: "base-estimate" | "liquidity-aware";
  liquidityUsd: number | null;
  positionToLiquidityPercent: number | null;
  estimatedPriceImpactPercent: number;
  estimatedOneWaySlippagePercent: number;
  estimatedGasUsd: number;
  estimatedSlippageUsd: number;
  estimatedRoundTripCostUsd: number;
  priceImpactGatePassed: boolean;
}

export interface OhlcvCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TimeframeIndicators {
  timeframe: Timeframe;
  candleCount: number;
  close: number | null;
  emaFast: number | null;
  emaSlow: number | null;
  rsi14: number | null;
  atrPercent: number | null;
  volumeRatio: number | null;
  trend: TrendDirection;
}

export interface BacktestResult {
  status: "ready" | "insufficient" | "no-trades";
  executionModel: "next-open-conservative";
  candleCount: number;
  tradeCount: number;
  winRate: number;
  netReturnPercent: number;
  benchmarkReturnPercent: number;
  excessReturnPercent: number;
  expectancyPercent: number;
  maxDrawdownPercent: number;
  profitFactor: number | null;
  tradeSharpeRatio: number | null;
  tradeSortinoRatio: number | null;
  robustness: {
    status: "pass" | "review" | "insufficient";
    simulationCount: number;
    tradeCount: number;
    profitablePathRate: number;
    medianReturnPercent: number;
    fifthPercentileReturnPercent: number;
    ninetyFifthPercentileDrawdownPercent: number;
    riskOfRuinPercent: number;
    costSensitivity: Array<{
      multiplier: 1 | 1.5 | 2;
      netReturnPercent: number;
    }>;
    reasons: string[];
  };
  walkForward: {
    status: "ready" | "insufficient" | "no-trades";
    windowCount: number;
    profitableWindowRate: number;
    tradeCount: number;
    netReturnPercent: number;
    maxDrawdownPercent: number;
  };
}

export type StrategyComparisonId =
  | "sumi-regime"
  | "ema-trend"
  | "rsi-reversion";

export interface StrategyComparisonResult {
  id: StrategyComparisonId;
  name: string;
  family: "regime" | "trend" | "mean-reversion";
  status: BacktestResult["status"];
  executionModel: "next-open-conservative";
  tradeCount: number;
  netReturnPercent: number;
  outOfSampleReturnPercent: number;
  maxDrawdownPercent: number;
  profitFactor: number | null;
  excessReturnPercent: number;
  rank: number;
}

export interface StrategyRegimeWalkForwardResult {
  id: StrategyComparisonId;
  name: string;
  windowCount: number;
  tradeCount: number;
  profitableWindowRate: number;
  netReturnPercent: number;
  rank: number;
}

export interface StrategyRegimeWalkForward {
  regime: MarketRegime;
  windowCount: number;
  leaderId: StrategyComparisonId | null;
  researchOnly: true;
  results: StrategyRegimeWalkForwardResult[];
}

export interface StrategyComparisonSnapshot {
  status: "ready" | "insufficient";
  candleCount: number;
  benchmarkReturnPercent: number;
  leaderId: StrategyComparisonId | null;
  researchOnly: true;
  results: StrategyComparisonResult[];
  walkForwardByRegime: StrategyRegimeWalkForward[];
  notes: string[];
}

export interface ChartRiskPlan {
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStopPercent: number;
  positionSizePercent: number;
  estimatedRoundTripCostUsd: number;
  expectedGrossProfitUsd: number;
  costGatePassed: boolean;
  execution: ExecutionCostEstimate;
}

export interface CorrelationPricePoint {
  timestamp: number;
  price: number;
}

export interface ChartAnalysis {
  symbol: string;
  status: ChartStatus;
  direction: ChartDirection;
  score: number;
  confidence: number;
  summary: string;
  reasons: string[];
  lastPrice: number | null;
  sparkline: number[];
  correlationSeries: CorrelationPricePoint[];
  timeframes: TimeframeIndicators[];
  regime: RegimeAssessment | null;
  risk: ChartRiskPlan | null;
  backtest: BacktestResult;
  strategyComparison: StrategyComparisonSnapshot;
}

export interface ChartModelSnapshot {
  generatedAt: string;
  source: "geckoterminal";
  cadenceMinutes: 5;
  requestedAssetCount: number;
  readyAssetCount: number;
  analyses: ChartAnalysis[];
  ethBenchmark: {
    status: "ready" | "unavailable";
    sparkline: number[];
    correlationSeries: CorrelationPricePoint[];
  };
  warnings: string[];
  /** One result per chart target (selected assets, then the ETH benchmark when it has a pair). */
  sourceChecks?: { geckoterminal: DataSourceCheckResult[] };
}

export type DataSourceId =
  | "blockscout"
  | "dexscreener"
  | "geckoterminal"
  | "ethereum-rpc"
  | "kyberswap";

/**
 * Outcome of one data-source check.
 * - policy-blocked: the source responded normally, but the target did not meet a trading condition.
 * - source-stale: the source responded, but its data was older than the freshness limit.
 * - source-unavailable: the request failed, timed out, returned a non-OK status or could not be parsed.
 * Only source-unavailable counts as a source failure.
 */
export type DataSourceCheckOutcome =
  | "success"
  | "policy-blocked"
  | "source-stale"
  | "source-unavailable";

export type DataSourceFailureKind =
  | "rate-limited"
  | "timeout"
  | "http-error"
  | "parse-error"
  | "other";

export interface DataSourceCheckResult {
  outcome: DataSourceCheckOutcome;
  /** Present only for source-unavailable. */
  failureKind?: DataSourceFailureKind;
}

export interface DataSourceFailureBreakdown {
  rateLimited: number;
  timeout: number;
  httpError: number;
  parseError: number;
  other: number;
}

export interface DataSourceQualityItem {
  source: DataSourceId;
  status: "healthy" | "degraded" | "unavailable";
  /** Same as requestedCount. Kept for compatibility. */
  observedCount: number;
  successfulCount: number;
  /** success / (success + source-unavailable). policy-blocked and source-stale are excluded. */
  coveragePercent: number;
  dataAgeSeconds: number | null;
  reasons: string[];
  qualityDefinition: 2;
  requestedCount: number;
  sourceUnavailableCount: number;
  sourceStaleCount: number;
  policyBlockedCount: number;
  failureBreakdown: DataSourceFailureBreakdown;
}

export interface DataSourceQualitySnapshot {
  generatedAt: string;
  status: "healthy" | "degraded";
  sources: DataSourceQualityItem[];
  readOnly: true;
}

export interface PaperDataSourceObservation {
  source: DataSourceId;
  status: DataSourceQualityItem["status"];
  coveragePercent: number;
  dataAgeSeconds: number | null;
  /** Absent on observations saved before the v2 definition (legacy). */
  qualityDefinition?: 2;
  requestedCount?: number;
  sourceUnavailableCount?: number;
  sourceStaleCount?: number;
  policyBlockedCount?: number;
  failureBreakdown?: DataSourceFailureBreakdown;
}

export type PaperDecisionDataQualityStatus =
  | "complete"
  | "partial"
  | "unavailable";

export interface PaperDecisionDataQuality {
  status: PaperDecisionDataQualityStatus;
  averageCoveragePercent: number;
  degradedSources: DataSourceId[];
  unavailableSources: DataSourceId[];
}

export interface DataSourceQualityHistoryItem {
  source: DataSourceId;
  status: "collecting" | "healthy" | "degraded" | "stale";
  lastObservedAt: string | null;
  observationAgeSeconds: number | null;
  observationCount: number;
  minimumObservations: 12;
  availabilityPercent: number;
  averageCoveragePercent: number;
  currentFailureStreak: number;
  /** Summed over v2 observations in the 24-hour window. */
  failureBreakdown: DataSourceFailureBreakdown;
}

export interface DataSourceIncidentItem {
  source: DataSourceId;
  status: "collecting" | "monitoring" | "incident" | "recovered";
  incidentCount24h: number;
  currentFailureStreak: number;
  currentRecoveryStreak: number;
  latestIncidentStartedAt: string | null;
  latestRecoveredAt: string | null;
}

/** Recent DEX activity for the selected pair; null when the API omitted it. */
export interface MarketOrderFlow {
  buysH1: number | null;
  sellsH1: number | null;
  buysH6: number | null;
  sellsH6: number | null;
  volumeH1Usd: number | null;
}

export interface MarketData {
  dexId: string;
  pairAddress: string;
  pairUrl: string;
  priceUsd: number | null;
  liquidityUsd: number;
  volume24hUsd: number;
  priceChange24h: number | null;
  orderFlow?: MarketOrderFlow;
}

export interface OnchainPreflightAssessment {
  status: "pass" | "blocked" | "unavailable";
  readOnly: true;
  chainId: number | null;
  blockNumber: number | null;
  blockTimestamp: string | null;
  blockAgeSeconds: number | null;
  contractCodePresent: boolean | null;
  checkedAt: string;
  reasons: string[];
  /** Set only when status is "unavailable". */
  failureKind?: DataSourceFailureKind;
}

export interface PortfolioAsset {
  symbol: string;
  name: string;
  contractAddress: string | null;
  amount: number;
  priceUsd: number | null;
  valueUsd: number;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24h: number | null;
  tradability: Tradability;
  reason: string;
  pairUrl: string | null;
  pairAddress: string | null;
  dexId: string | null;
  contractSafety: ContractSafetyAssessment | null;
  quotePreflight: PreflightAssessment | null;
  onchainPreflight: OnchainPreflightAssessment | null;
  orderFlow?: MarketOrderFlow | null;
}

export interface PortfolioSnapshot {
  walletAddress: string;
  generatedAt: string;
  source: "blockscout+dexscreener";
  totalUsd: number;
  tradeableUsd: number;
  blockedUsd: number;
  gasBalanceEth: number;
  gasBalanceUsd: number;
  gasReserveEth: number;
  assets: PortfolioAsset[];
  ignoredTokenCount: number;
  warnings: string[];
  /** One result per asset with a positive amount, including the ETH gas asset. */
  sourceChecks?: { dexscreener: DataSourceCheckResult[] };
}

/** Which step of the plan stopped a chart BUY, or "passed" when the BUY survived. */
export type BuyGateId =
  | "passed"
  | "not-tradable"
  | "contract-safety"
  | "quote-preflight"
  | "onchain-preflight"
  | "robustness"
  | "cost-gate"
  | "model-drift"
  | "portfolio-risk"
  | "budget"
  | "not-in-plan";

export interface StrategySignal {
  symbol: string;
  action: SignalAction;
  allocationPercent: number;
  estimatedUsd: number;
  reason: string;
  modelScore: number | null;
  costGatePassed: boolean | null;
  /** Set only when the chart model said BUY for this asset. */
  buyGate?: BuyGateId;
  /**
   * Every filter gate the chart BUY failed, in evaluation order. Empty when all
   * filters passed (the BUY may still stop at "budget").
   */
  buyGateFailures?: BuyGateId[];
}

export interface PortfolioCorrelationPair {
  leftSymbol: string;
  rightSymbol: string;
  correlation: number;
  sampleCount: number;
  combinedExposurePercent: number;
}

export interface PortfolioRiskAssessment {
  status: "pass" | "blocked" | "unavailable";
  blockNewBuys: boolean;
  maxSingleAssetSymbol: string | null;
  maxSingleAssetPercent: number;
  maxEthCorrelation: number | null;
  maxEthCorrelationSymbol: string | null;
  maxEthCorrelationSampleCount: number | null;
  minimumCorrelationSampleCount: number | null;
  correlationMethod: "timestamp-inner-join";
  highCorrelationPairs: PortfolioCorrelationPair[];
  dailyNetPnlUsd: number;
  dailyLossPercent: number;
  longestLossStreak: number;
  currentLossStreak: number;
  limits: {
    singleAssetPercent: 35;
    correlatedExposurePercent: 50;
    correlation: 0.85;
    dailyLossPercent: 3;
    lossStreak: 3;
  };
  reasons: string[];
}

export interface ModelDriftAssessment {
  model: PaperSignalModel;
  status: "stable" | "degraded" | "recovering" | "collecting" | "unavailable";
  blockNewBuys: boolean;
  recentDays: 7;
  baselineDays: 23;
  recentSamples: number;
  baselineSamples: number;
  recentNetPnlUsd: number;
  recentAverageNetReturnPercent: number;
  baselineAverageNetReturnPercent: number;
  averageReturnDropPercentagePoints: number;
  recentProfitFactor: number | null;
  baselineProfitFactor: number | null;
  recoveryConfirmationHours: 12;
  recoveryConfirmationPassed: boolean;
  limits: {
    minimumRecentSamples: 10;
    minimumBaselineSamples: 20;
    averageReturnDropPercentagePoints: 1.5;
    recentProfitFactor: 0.8;
    baselineProfitFactor: 1.2;
  };
  reasons: string[];
}

export type ModelDriftSnapshot = Record<
  PaperSignalModel,
  ModelDriftAssessment
>;

export interface StrategyPlan {
  mode: "paper";
  generatedAt: string;
  cadenceMinutes: 5;
  executionLocked: true;
  portfolioRisk: PortfolioRiskAssessment;
  modelDrift: ModelDriftSnapshot;
  signals: StrategySignal[];
  summary: {
    buyCount: number;
    sellCount: number;
    holdCount: number;
    blockedCount: number;
  };
}

export type TrendDecision = "PAPER" | "WATCH" | "BLOCK";

export interface TrendCandidate {
  rank: number;
  contractAddress: string;
  pairAddress: string;
  name: string;
  symbol: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  buyers24h: number;
  sellers24h: number;
  sentimentPositivePercentage: number | null;
  suspiciousReportCount: number;
  poolAgeDays: number;
  score: number;
  decision: TrendDecision;
  reasons: string[];
  contractSafety: ContractSafetyAssessment;
  quotePreflight: PreflightAssessment;
}

export interface TrendPaperRotation {
  fromSymbol: string;
  fromContractAddress: string;
  toSymbol: string;
  toContractAddress: string;
  entryPriceUsd: number;
  amountUsd: number;
  allocationPercent: number;
  estimatedRoundTripCostUsd: number;
  estimatedPriceImpactPercent: number;
  estimatedOneWaySlippagePercent: number;
  costGatePassed: boolean;
  score: number;
  executionLocked: true;
}

export interface TrendScoutSnapshot {
  generatedAt: string;
  source: "geckoterminal";
  mode: "shadow";
  executionLocked: true;
  candidateCount: number;
  paperCandidateCount: number;
  candidates: TrendCandidate[];
  paperRotation: TrendPaperRotation | null;
  warnings: string[];
}

export type PaperJournalStatus =
  | "disabled"
  | "collecting"
  | "qualified"
  | "rejected"
  | "error";

export type PaperSignalModel = "chart" | "community-trend";

export interface PaperSignalObservation {
  decisionId?: string;
  model?: PaperSignalModel;
  priceKey?: string;
  contractAddress?: string;
  symbol: string;
  direction: Exclude<ChartDirection, "HOLD">;
  entryPriceUsd: number;
  modelScore: number;
  confidence: number;
  marketRegime?: MarketRegime;
  decisionReasons?: string[];
  notionalUsd: number;
  estimatedCostUsd: number;
  costGatePassed: boolean;
  /** Chart BUY only. Missing on records saved before gate tracking. */
  buyGate?: BuyGateId;
  buyGateFailures?: BuyGateId[];
  /** Order-flow context at signal time. Recorded for research, not used by the model. */
  orderFlow?: PaperOrderFlowFeatures;
  /** Chart exit plan at signal time. Missing on older records. */
  stopLossPercent?: number;
  takeProfitPercent?: number;
  trailingStopPercent?: number;
}

export interface PaperOrderFlowFeatures {
  /** Share of DEX buys among buy + sell transactions; null below 20 transactions. */
  buyShareH1: number | null;
  buyShareH6: number | null;
  /** Last-hour volume against the 24h hourly average; 1 means an average hour. */
  volumeAccelerationH1: number | null;
}

export type PaperBarrierExit =
  | "take-profit"
  | "stop-loss"
  | "trailing-stop"
  | "horizon";

/** Result if the signal had been closed by its own stop / take-profit rules. */
export interface PaperBarrierOutcome {
  exit: PaperBarrierExit;
  exitTime: string;
  exitPriceUsd: number;
  grossReturnPercent: number;
  netReturnPercent: number;
  netPnlUsd: number;
  won: boolean;
  /** Scan prices seen strictly between entry and the six-hour horizon (71 when none are missing). */
  pricePointCount: number;
}

/** Net return after costs if the signal had been closed at each horizon. */
export interface PaperHorizonNetReturns {
  h1: number | null;
  h2: number | null;
  h4: number | null;
  h6: number;
}

export interface SafetyControlSnapshot {
  status: "monitoring" | "stopped" | "unavailable";
  emergencyStop: boolean;
  source: "environment" | "redis" | "unavailable";
  executionLocked: true;
  reason: string;
  updatedAt: string | null;
}

export interface PaperScanRecord {
  schemaVersion: 1;
  id: string;
  bucketTimeMs: number;
  generatedAt: string;
  walletAddress: string;
  portfolioValueUsd: number;
  executionLocked: true;
  prices: Record<string, number>;
  signals: PaperSignalObservation[];
  dataSourceQuality?: PaperDataSourceObservation[];
}

export interface PaperTradeOutcome extends PaperSignalObservation {
  signalTime: string;
  outcomeTime: string;
  exitPriceUsd: number;
  grossReturnPercent: number;
  netReturnPercent: number;
  netPnlUsd: number;
  won: boolean;
  entryDataQuality?: PaperDecisionDataQuality;
  barrier?: PaperBarrierOutcome;
  horizonNetReturnsPercent?: PaperHorizonNetReturns;
}

export interface PaperDataQualityPerformance {
  band: PaperDecisionDataQualityStatus | "unknown";
  status: "collecting" | "monitoring";
  minimumSamples: 10;
  maturedCount: number;
  winRate: number;
  netPnlUsd: number;
  averageNetReturnPercent: number;
}

export interface PaperSourceQualityImpact {
  source: DataSourceId;
  status: "collecting" | "monitoring" | "performance-alert";
  minimumSamples: 10;
  cleanCount: number;
  impairedCount: number;
  cleanAverageNetReturnPercent: number;
  impairedAverageNetReturnPercent: number;
  returnGapPercentagePoints: number;
  impairedNetPnlUsd: number;
}

export interface PaperSourceReasonImpact {
  source: DataSourceId;
  status: "collecting" | "monitoring" | "performance-alert";
  minimumSamples: 5;
  reason: string | null;
  cleanCount: number;
  impairedCount: number;
  cleanAverageNetReturnPercent: number;
  impairedAverageNetReturnPercent: number;
  returnGapPercentagePoints: number;
  impairedNetPnlUsd: number;
}

export interface PaperQualification {
  minimumSamples: number;
  samplePassed: boolean;
  netProfitPassed: boolean;
  profitFactorPassed: boolean;
  drawdownPassed: boolean;
  costCoveragePassed: boolean;
  overallPassed: boolean;
}

export interface PaperOperationalReadiness {
  status: "collecting" | "ready" | "blocked";
  minimumObservationHours: 168;
  observationHours: number;
  observationPassed: boolean;
  minimumScanCoveragePercent: 80;
  scanCoverage24hPercent: number;
  scanCoveragePassed: boolean;
  latestScanFresh: boolean;
  overallPassed: boolean;
  reasons: string[];
}

export interface PaperModelPerformance {
  model: PaperSignalModel;
  signalCount: number;
  maturedCount: number;
  pendingCount: number;
  costGatePassedCount: number;
  costGatePassRate: number;
  winRate: number;
  netPnlUsd: number;
  averageNetReturnPercent: number;
  profitFactor: number | null;
  maxDrawdownUsd: number;
  maxDrawdownPercent: number;
  longestLossStreak: number;
  currentLossStreak: number;
  qualification: PaperQualification;
}

export interface PaperPeriodPerformance {
  days: 1 | 7 | 30;
  maturedCount: number;
  winRate: number;
  netPnlUsd: number;
  averageNetReturnPercent: number;
  profitFactor: number | null;
  maxDrawdownPercent: number;
}

export interface PaperDriftWindowPerformance {
  maturedCount: number;
  winRate: number;
  netPnlUsd: number;
  averageNetReturnPercent: number;
  profitFactor: number | null;
  maxDrawdownPercent: number;
}

export interface PaperDriftPerformance {
  recent: PaperDriftWindowPerformance;
  baseline: PaperDriftWindowPerformance;
  confirmation?: {
    offsetHours: 12;
    recent: PaperDriftWindowPerformance;
    baseline: PaperDriftWindowPerformance;
  };
}

export type PaperConfidenceBandId = "low" | "medium" | "high";

export interface PaperConfidenceBandPerformance {
  band: PaperConfidenceBandId;
  minimumConfidence: number;
  maximumConfidence: number;
  maturedCount: number;
  winRate: number;
  netPnlUsd: number;
  averageNetReturnPercent: number;
}

export interface PaperConfidenceCalibration {
  model: PaperSignalModel;
  status: "collecting" | "aligned" | "inverted";
  minimumSamplesPerGroup: 10;
  highConfidencePremiumPercentagePoints: number | null;
  bands: PaperConfidenceBandPerformance[];
  reasons: string[];
  researchOnly: true;
}

export interface PaperConfidenceReliability {
  model: PaperSignalModel;
  /**
   * informative: out-of-sample, confidence-based win probabilities beat the
   *   base win rate with 95% confidence and rise with confidence.
   * inverted: they beat the base rate, but win probability falls as
   *   confidence rises.
   * uninformative: no significant improvement over the base win rate.
   */
  status: "collecting" | "informative" | "inverted" | "uninformative";
  method: "platt-walk-forward";
  minimumTrainSamples: 20;
  minimumTestSamples: 10;
  /** Walk-forward folds that had enough settled history to be scored. */
  foldCount: number;
  /** Outcomes scored out of sample, across all folds. */
  testCount: number;
  /** Distinct scan times among testCount; one scan counts as one sample. */
  independentSampleCount: number;
  /** Training outcomes left out because they settled after the fold began. */
  embargoDroppedCount: number;
  brierScore: number | null;
  baselineBrierScore: number | null;
  /** 1 - brierScore / baselineBrierScore on the out-of-sample outcomes. */
  brierSkillScore: number | null;
  /** 95% interval of the per-outcome Brier improvement over the base rate. */
  improvementLow: number | null;
  improvementHigh: number | null;
  /** Change in log-odds of a win per 10 confidence points (all outcomes). */
  slopePer10Points: number | null;
  /** Win probability fitted on all outcomes, for display. */
  calibratedWinRates: Array<{ confidence: number; winProbabilityPercent: number }>;
  reasons: string[];
  researchOnly: true;
}

export interface PaperScoringSummary {
  winRate: number;
  averageNetReturnPercent: number;
  netPnlUsd: number;
  profitFactor: number | null;
}

export interface PaperHorizonPerformance {
  horizon: keyof PaperHorizonNetReturns;
  hours: 1 | 2 | 4 | 6;
  maturedCount: number;
  independentSampleCount: number;
  averageNetReturnPercent: number | null;
  confidenceLowPercent: number | null;
  confidenceHighPercent: number | null;
}

/**
 * The same chart signals scored two ways: at the fixed six-hour horizon
 * (used for promotion) and by their own stop / take-profit rules.
 */
export interface PaperScoringComparison {
  /**
   * barrier-better / barrier-worse: the 95% interval of the per-signal
   * difference (barrier minus six-hour) lies wholly above / below zero.
   */
  status: "collecting" | "barrier-better" | "barrier-worse" | "similar";
  minimumSamples: 20;
  minimumIndependentSamples: 10;
  /** Paths with fewer scan prices than this are left out as too sparse. */
  minimumPricePointCount: 36;
  pairedCount: number;
  independentSampleCount: number;
  sparsePathCount: number;
  fixedHorizon: PaperScoringSummary;
  barrier: PaperScoringSummary;
  exitMix: Record<PaperBarrierExit, number>;
  differenceLowPercent: number | null;
  differenceHighPercent: number | null;
  horizons: PaperHorizonPerformance[];
  reasons: string[];
  researchOnly: true;
}

export type PaperOrderFlowFeatureId =
  | "buy-share-h1"
  | "buy-share-h6"
  | "volume-acceleration-h1";

export interface PaperOrderFlowAttributionRow {
  feature: PaperOrderFlowFeatureId;
  horizon: "h1" | "h6";
  /**
   * For buy share: signals the flow agreed with (buys dominate for a BUY,
   * sells for a SELL) against those it disagreed with. For volume
   * acceleration: busy hours against quiet hours.
   */
  favorableCount: number;
  unfavorableCount: number;
  favorableAverageNetReturnPercent: number | null;
  unfavorableAverageNetReturnPercent: number | null;
  /** Interval of favorable minus unfavorable, at the family confidence. */
  differenceLowPercent: number | null;
  differenceHighPercent: number | null;
  status: "collecting" | "supports-signal" | "contradicts-signal" | "no-edge";
}

/**
 * Whether DEX order flow at signal time separates good chart signals from bad
 * ones. Research only: the chart model does not read these features.
 */
export interface PaperOrderFlowAttribution {
  /** Bonferroni-adjusted so all rows together keep a 5% false-alarm rate. */
  familyConfidence: number;
  minimumSamplesPerGroup: 10;
  minimumIndependentSamplesPerGroup: 5;
  evidencedCount: number;
  rows: PaperOrderFlowAttributionRow[];
  researchOnly: true;
}

export type PaperChallengerId =
  | "flow-aligned-only"
  | "skip-flow-opposed"
  | "confidence-70-plus";

export interface PaperChallengerResult {
  id: PaperChallengerId;
  description: string;
  /** Only chart signals at or after this time are scored for this challenger. */
  registeredAt: string;
  /** Chart signals after registration that carry the data the rule reads. */
  baselineCount: number;
  keptCount: number;
  excludedCount: number;
  excludedIndependentSampleCount: number;
  baselineAverageNetReturnPercent: number | null;
  keptAverageNetReturnPercent: number | null;
  excludedAverageNetReturnPercent: number | null;
  /** Challenger net P/L minus baseline net P/L: minus the excluded signals' P/L. */
  netPnlDifferenceUsd: number;
  /** Interval of the excluded signals' mean net return, at the family confidence. */
  excludedLowPercent: number | null;
  excludedHighPercent: number | null;
  /**
   * challenger-better: the signals it skips lose money (interval below 0).
   * challenger-worse: the signals it skips make money (interval above 0).
   */
  status: "collecting" | "challenger-better" | "challenger-worse" | "no-difference";
}

/**
 * Pre-registered filters over the live chart signals, scored only on signals
 * recorded after each filter's registration. Research only: nothing trades on
 * a challenger and none replaces the chart model automatically.
 */
export interface PaperChallengerComparison {
  familyConfidence: number;
  minimumExcludedSamples: 10;
  minimumExcludedIndependentSamples: 5;
  minimumKeptSamples: 10;
  challengers: PaperChallengerResult[];
  researchOnly: true;
}

export interface PaperBuyGatePerformance {
  gate: BuyGateId | "unknown";
  /** BUYs this gate failed, alone or together with other gates. */
  blockedCount: number;
  /** BUYs stopped by this gate alone; every metric below uses only these. */
  maturedCount: number;
  /** Distinct scan times among maturedCount; BUYs from one scan move together. */
  independentSampleCount: number;
  winRate: number;
  netPnlUsd: number;
  averageNetReturnPercent: number;
  /** Student-t 95% interval of the per-scan mean net return. */
  confidenceLowPercent: number | null;
  confidenceHighPercent: number | null;
  profitFactor: number | null;
  minimumSamples: 10;
  minimumIndependentSamples: 5;
  /**
   * baseline: BUYs that passed every gate.
   * protective: the whole interval is below 0; the gate avoided losses.
   * missed-profit: the whole interval is above 0; the gate blocked winners.
   * inconclusive: the interval still contains 0.
   */
  status: "baseline" | "collecting" | "protective" | "missed-profit" | "inconclusive";
  reasons: string[];
  researchOnly: true;
}

export interface PaperRegimePerformance {
  regime: MarketRegime;
  maturedCount: number;
  winRate: number;
  netPnlUsd: number;
  averageNetReturnPercent: number;
  profitFactor: number | null;
  minimumSamples: 10;
  status: "collecting" | "monitoring" | "alert";
  alert: boolean;
  limits: {
    averageNetReturnPercent: -1;
    profitFactor: 0.8;
  };
  reasons: string[];
  researchOnly: true;
}

export interface PaperAssetPerformance {
  symbol: string;
  maturedCount: number;
  winRate: number;
  netPnlUsd: number;
  averageNetReturnPercent: number;
  profitFactor: number | null;
}

export interface PaperPerformanceTimelinePoint {
  date: string;
  tradeCount: number;
  netPnlUsd: number;
  cumulativeNetPnlUsd: number;
}

export interface PaperJournalSnapshot {
  status: PaperJournalStatus;
  storageConfigured: boolean;
  executionLocked: true;
  windowDays: 7;
  analyticsWindowDays: 30;
  horizonHours: 6;
  startedAt: string | null;
  lastScanAt: string | null;
  scanCount: number;
  signalCount: number;
  maturedCount: number;
  pendingCount: number;
  costGatePassedCount: number;
  costGatePassRate: number;
  winRate: number;
  netPnlUsd: number;
  dailyNetPnlUsd: number;
  dailyLossPercent: number;
  averageNetReturnPercent: number;
  profitFactor: number | null;
  maxDrawdownUsd: number;
  maxDrawdownPercent: number;
  longestLossStreak: number;
  currentLossStreak: number;
  operationalReadiness: PaperOperationalReadiness;
  averageWinPercent: number;
  averageLossPercent: number;
  payoffRatio: number | null;
  qualification: PaperQualification;
  modelPerformance: Record<PaperSignalModel, PaperModelPerformance>;
  periodPerformance: PaperPeriodPerformance[];
  periodPerformanceByModel: Record<PaperSignalModel, PaperPeriodPerformance[]>;
  driftPerformanceByModel: Record<PaperSignalModel, PaperDriftPerformance>;
  confidenceCalibrationByModel: Record<PaperSignalModel, PaperConfidenceCalibration>;
  confidenceReliabilityByModel: Record<PaperSignalModel, PaperConfidenceReliability>;
  regimePerformance: PaperRegimePerformance[];
  buyGatePerformance: PaperBuyGatePerformance[];
  scoringComparison: PaperScoringComparison;
  orderFlowAttribution: PaperOrderFlowAttribution;
  challengerComparison: PaperChallengerComparison;
  assetPerformance: PaperAssetPerformance[];
  performanceTimeline: PaperPerformanceTimelinePoint[];
  dataSourceQualityHistory24h: DataSourceQualityHistoryItem[];
  dataSourceIncidents24h: DataSourceIncidentItem[];
  dataQualityPerformance: PaperDataQualityPerformance[];
  sourceQualityImpact: PaperSourceQualityImpact[];
  sourceReasonImpact: PaperSourceReasonImpact[];
  recentOutcomes: PaperTradeOutcome[];
  message: string;
}
