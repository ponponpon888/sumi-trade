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
}

export type DataSourceId =
  | "blockscout"
  | "dexscreener"
  | "geckoterminal"
  | "ethereum-rpc"
  | "kyberswap";

export interface DataSourceQualityItem {
  source: DataSourceId;
  status: "healthy" | "degraded" | "unavailable";
  observedCount: number;
  successfulCount: number;
  coveragePercent: number;
  dataAgeSeconds: number | null;
  reasons: string[];
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
}

export interface DataSourceQualityHistoryItem {
  source: DataSourceId;
  status: "collecting" | "healthy" | "degraded";
  observationCount: number;
  minimumObservations: 12;
  availabilityPercent: number;
  averageCoveragePercent: number;
  currentFailureStreak: number;
}

export interface MarketData {
  dexId: string;
  pairAddress: string;
  pairUrl: string;
  priceUsd: number | null;
  liquidityUsd: number;
  volume24hUsd: number;
  priceChange24h: number | null;
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
}

export interface StrategySignal {
  symbol: string;
  action: SignalAction;
  allocationPercent: number;
  estimatedUsd: number;
  reason: string;
  modelScore: number | null;
  costGatePassed: boolean | null;
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
  regimePerformance: PaperRegimePerformance[];
  assetPerformance: PaperAssetPerformance[];
  performanceTimeline: PaperPerformanceTimelinePoint[];
  dataSourceQualityHistory24h: DataSourceQualityHistoryItem[];
  recentOutcomes: PaperTradeOutcome[];
  message: string;
}
