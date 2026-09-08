import type {
  ChartModelSnapshot,
  PaperJournalSnapshot,
  PaperAssetPerformance,
  PaperConfidenceCalibration,
  PaperConfidenceBandPerformance,
  PaperDriftPerformance,
  PaperDataQualityPerformance,
  PaperDecisionDataQuality,
  PaperModelPerformance,
  PaperOperationalReadiness,
  PaperQualification,
  PaperRegimePerformance,
  PaperPerformanceTimelinePoint,
  PaperPeriodPerformance,
  PaperScanRecord,
  PaperSignalModel,
  PaperSignalObservation,
  PaperSourceQualityImpact,
  PaperTradeOutcome,
  PortfolioSnapshot,
  StrategyPlan,
  TrendScoutSnapshot,
  DataSourceId,
} from "@/lib/types";
import {
  assessDataSourceQuality,
  calculateDataSourceIncidents,
  calculateDataSourceQualityHistory,
} from "@/lib/data-source-quality";

export const JOURNAL_WINDOW_DAYS = 7 as const;
export const JOURNAL_ANALYTICS_WINDOW_DAYS = 30 as const;
export const JOURNAL_RECORD_WINDOW_DAYS = 31 as const;
export const OUTCOME_HORIZON_HOURS = 6 as const;
export const MINIMUM_QUALIFICATION_SAMPLES = 30;
export const MINIMUM_OBSERVATION_HOURS = 168 as const;
export const MINIMUM_SCAN_COVERAGE_PERCENT = 80 as const;

const SCAN_BUCKET_MS = 5 * 60 * 1_000;
const SIGNAL_COOLDOWN_MS = OUTCOME_HORIZON_HOURS * 60 * 60 * 1_000;
const OUTCOME_HORIZON_MS = OUTCOME_HORIZON_HOURS * 60 * 60 * 1_000;
const MAX_OUTCOME_DELAY_MS = 90 * 60 * 1_000;
const MIN_PROFIT_FACTOR = 1.2;
const MAX_DRAWDOWN_PERCENT = 8;
const MIN_COST_GATE_COVERAGE_PERCENT = 70;
const SCAN_FRESHNESS_MINUTES = 12;
const ONE_HOUR_MS = 60 * 60 * 1_000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const MINIMUM_CALIBRATION_SAMPLES = 10 as const;
const MINIMUM_REGIME_SAMPLES = 10 as const;
const REGIME_ALERT_AVERAGE_RETURN_PERCENT = -1 as const;
const REGIME_ALERT_PROFIT_FACTOR = 0.8 as const;
const MINIMUM_DATA_QUALITY_SAMPLES = 10 as const;
const DATA_QUALITY_ALERT_GAP_PERCENTAGE_POINTS = -1 as const;
const DATA_SOURCE_IDS: DataSourceId[] = [
  "blockscout",
  "dexscreener",
  "geckoterminal",
  "ethereum-rpc",
  "kyberswap",
];

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function compactDecisionReasons(...groups: Array<Array<string | undefined>>): string[] {
  return [...new Set(
    groups
      .flat()
      .map((reason) => reason?.trim())
      .filter((reason): reason is string => Boolean(reason)),
  )].slice(0, 5);
}

function decisionDataQuality(
  record: PaperScanRecord,
): PaperDecisionDataQuality | undefined {
  if (!record.dataSourceQuality?.length) return undefined;
  const bySource = new Map(
    record.dataSourceQuality.map((observation) => [
      observation.source,
      observation,
    ]),
  );
  const degradedSources: DataSourceId[] = [];
  const unavailableSources: DataSourceId[] = [];
  let coverageTotal = 0;

  for (const source of DATA_SOURCE_IDS) {
    const observation = bySource.get(source);
    coverageTotal += observation?.coveragePercent ?? 0;
    if (!observation || observation.status === "unavailable") {
      unavailableSources.push(source);
    } else if (observation.status === "degraded") {
      degradedSources.push(source);
    }
  }

  return {
    status: unavailableSources.length
      ? "unavailable"
      : degradedSources.length
        ? "partial"
        : "complete",
    averageCoveragePercent: round(coverageTotal / DATA_SOURCE_IDS.length),
    degradedSources,
    unavailableSources,
  };
}

export function calculateOperationalReadiness(
  records: PaperScanRecord[],
  nowMs: number,
  modelQualification: PaperQualification,
): PaperOperationalReadiness {
  const ordered = records.toSorted(
    (left, right) => left.bucketTimeMs - right.bucketTimeMs,
  );
  const firstScanMs = ordered[0]?.bucketTimeMs ?? null;
  const lastScanMs = ordered.at(-1)?.bucketTimeMs ?? null;
  const observationHours = firstScanMs === null
    ? 0
    : round(Math.max(0, nowMs - firstScanMs) / ONE_HOUR_MS, 1);
  const observationPassed = observationHours >= MINIMUM_OBSERVATION_HOURS;
  const recentBucketCount = new Set(
    ordered
      .filter((record) => record.bucketTimeMs >= nowMs - ONE_DAY_MS)
      .map((record) => record.bucketTimeMs),
  ).size;
  const expectedDailyScans = ONE_DAY_MS / SCAN_BUCKET_MS;
  const scanCoverage24hPercent = round(
    Math.min(100, (recentBucketCount / expectedDailyScans) * 100),
    1,
  );
  const scanCoveragePassed =
    scanCoverage24hPercent >= MINIMUM_SCAN_COVERAGE_PERCENT;
  const latestScanFresh =
    lastScanMs !== null &&
    nowMs >= lastScanMs &&
    nowMs - lastScanMs <= SCAN_FRESHNESS_MINUTES * 60_000;
  const reasons: string[] = [];

  if (!observationPassed) {
    reasons.push(`観測期間が${MINIMUM_OBSERVATION_HOURS}時間に達していません。`);
  }
  if (!modelQualification.samplePassed) {
    reasons.push(`採点済み件数が${modelQualification.minimumSamples}件に達していません。`);
  }
  if (!scanCoveragePassed) {
    reasons.push(`直近24時間のスキャン網羅率が${MINIMUM_SCAN_COVERAGE_PERCENT}%未満です。`);
  }
  if (!latestScanFresh) {
    reasons.push("最新スキャンが12分以内に確認できません。");
  }
  if (
    observationPassed &&
    modelQualification.samplePassed &&
    !modelQualification.overallPassed
  ) {
    reasons.push("モデル成績が昇格条件を満たしていません。");
  }

  const overallPassed =
    observationPassed &&
    scanCoveragePassed &&
    latestScanFresh &&
    modelQualification.overallPassed;
  const status = overallPassed
    ? "ready"
    : !observationPassed || !modelQualification.samplePassed
      ? "collecting"
      : "blocked";

  return {
    status,
    minimumObservationHours: MINIMUM_OBSERVATION_HOURS,
    observationHours,
    observationPassed,
    minimumScanCoveragePercent: MINIMUM_SCAN_COVERAGE_PERCENT,
    scanCoverage24hPercent,
    scanCoveragePassed,
    latestScanFresh,
    overallPassed,
    reasons,
  };
}

function bucketId(bucketTimeMs: number): string {
  return new Date(bucketTimeMs).toISOString().replace(/[:.]/g, "-");
}

export function createPaperScanRecord(
  data: {
    snapshot: PortfolioSnapshot;
    chartModel: ChartModelSnapshot;
    plan: StrategyPlan;
    trendScout?: TrendScoutSnapshot;
  },
  nowMs = Date.now(),
  trackedPrices: Record<string, number> = {},
): PaperScanRecord {
  const bucketTimeMs = Math.floor(nowMs / SCAN_BUCKET_MS) * SCAN_BUCKET_MS;
  const recordId = bucketId(bucketTimeMs);
  const prices: Record<string, number> = {};
  const planBySymbol = new Map(
    data.plan.signals.map((signal) => [signal.symbol, signal]),
  );
  const signals: PaperSignalObservation[] = [];
  const dataSourceQuality = assessDataSourceQuality(
    data.snapshot,
    data.chartModel,
    nowMs,
  ).sources.map(({ source, status, coveragePercent, dataAgeSeconds }) => ({
    source,
    status,
    coveragePercent,
    dataAgeSeconds,
  }));

  for (const analysis of data.chartModel.analyses) {
    if (finitePositive(analysis.lastPrice)) {
      prices[analysis.symbol] = analysis.lastPrice;
    }

    if (
      analysis.status !== "ready" ||
      analysis.direction === "HOLD" ||
      !finitePositive(analysis.lastPrice) ||
      !analysis.risk
    ) {
      continue;
    }

    const planned = planBySymbol.get(analysis.symbol);
    const modelNotional =
      data.snapshot.totalUsd * (analysis.risk.positionSizePercent / 100);
    const plannedNotional =
      planned?.action === analysis.direction && planned.estimatedUsd > 0
        ? planned.estimatedUsd
        : 0;

    signals.push({
      decisionId: `${recordId}:chart:${analysis.symbol}:${analysis.direction}`,
      model: "chart",
      priceKey: analysis.symbol,
      symbol: analysis.symbol,
      direction: analysis.direction,
      entryPriceUsd: analysis.lastPrice,
      modelScore: analysis.score,
      confidence: analysis.confidence,
      marketRegime: analysis.regime?.regime,
      decisionReasons: compactDecisionReasons(
        [analysis.summary],
        analysis.reasons,
        analysis.regime?.reasons ?? [],
        [planned?.reason],
      ),
      notionalUsd: round(Math.max(plannedNotional, modelNotional)),
      estimatedCostUsd: round(analysis.risk.estimatedRoundTripCostUsd),
      costGatePassed: analysis.risk.costGatePassed,
    });
  }

  for (const candidate of data.trendScout?.candidates ?? []) {
    if (finitePositive(candidate.priceUsd)) {
      prices[candidate.contractAddress.toLowerCase()] = candidate.priceUsd;
    }
  }

  for (const [key, value] of Object.entries(trackedPrices)) {
    if (finitePositive(value)) prices[key.toLowerCase()] = value;
  }

  const rotation = data.trendScout?.paperRotation;
  if (rotation && finitePositive(rotation.entryPriceUsd)) {
    const priceKey = rotation.toContractAddress.toLowerCase();
    const candidate = data.trendScout?.candidates.find(
      (item) => item.contractAddress.toLowerCase() === priceKey,
    );
    prices[priceKey] = rotation.entryPriceUsd;
    signals.push({
      decisionId: `${recordId}:community-trend:${priceKey}:BUY`,
      model: "community-trend",
      priceKey,
      contractAddress: priceKey,
      symbol: rotation.toSymbol,
      direction: "BUY",
      entryPriceUsd: rotation.entryPriceUsd,
      modelScore: rotation.score,
      confidence: rotation.score,
      decisionReasons: compactDecisionReasons(candidate?.reasons ?? []),
      notionalUsd: rotation.amountUsd,
      estimatedCostUsd: rotation.estimatedRoundTripCostUsd,
      costGatePassed: rotation.costGatePassed,
    });
  }

  return {
    schemaVersion: 1,
    id: recordId,
    bucketTimeMs,
    generatedAt: new Date(nowMs).toISOString(),
    walletAddress: data.snapshot.walletAddress.toLowerCase(),
    portfolioValueUsd: round(data.snapshot.totalUsd),
    executionLocked: true,
    prices,
    signals,
    dataSourceQuality,
  };
}

function selectIndependentSignals(
  records: PaperScanRecord[],
): Array<{ record: PaperScanRecord; signal: PaperSignalObservation }> {
  const selected: Array<{
    record: PaperScanRecord;
    signal: PaperSignalObservation;
  }> = [];
  const lastSignalAt = new Map<string, number>();
  const seenDecisionIds = new Set<string>();

  for (const record of records) {
    for (const signal of record.signals) {
      if (signal.decisionId && seenDecisionIds.has(signal.decisionId)) continue;
      const key = `${signal.model ?? "chart"}:${signal.priceKey ?? signal.symbol}:${signal.direction}`;
      const previous = lastSignalAt.get(key) ?? Number.NEGATIVE_INFINITY;
      if (record.bucketTimeMs - previous < SIGNAL_COOLDOWN_MS) continue;
      selected.push({ record, signal });
      if (signal.decisionId) seenDecisionIds.add(signal.decisionId);
      lastSignalAt.set(key, record.bucketTimeMs);
    }
  }

  return selected;
}

function settleSignal(
  candidate: { record: PaperScanRecord; signal: PaperSignalObservation },
  records: PaperScanRecord[],
): PaperTradeOutcome | null {
  const targetTime = candidate.record.bucketTimeMs + OUTCOME_HORIZON_MS;
  const priceKey = candidate.signal.priceKey ?? candidate.signal.symbol;
  const outcomeRecord = records.find(
    (record) =>
      record.bucketTimeMs >= targetTime &&
      record.bucketTimeMs <= targetTime + MAX_OUTCOME_DELAY_MS &&
      finitePositive(record.prices[priceKey]),
  );
  const exitPrice = outcomeRecord?.prices[priceKey];

  if (!outcomeRecord || !finitePositive(exitPrice)) return null;

  const rawChange =
    ((exitPrice - candidate.signal.entryPriceUsd) /
      candidate.signal.entryPriceUsd) *
    100;
  const grossReturnPercent =
    candidate.signal.direction === "BUY" ? rawChange : -rawChange;
  const costPercent =
    candidate.signal.notionalUsd > 0
      ? (candidate.signal.estimatedCostUsd / candidate.signal.notionalUsd) * 100
      : 0;
  const netReturnPercent = grossReturnPercent - costPercent;
  const netPnlUsd =
    candidate.signal.notionalUsd * (grossReturnPercent / 100) -
    candidate.signal.estimatedCostUsd;

  return {
    ...candidate.signal,
    entryDataQuality: decisionDataQuality(candidate.record),
    signalTime: candidate.record.generatedAt,
    outcomeTime: outcomeRecord.generatedAt,
    exitPriceUsd: exitPrice,
    grossReturnPercent: round(grossReturnPercent),
    netReturnPercent: round(netReturnPercent),
    netPnlUsd: round(netPnlUsd),
    won: netPnlUsd > 0,
  };
}

export function calculateDataQualityPerformance(
  outcomes: PaperTradeOutcome[],
): PaperDataQualityPerformance[] {
  const bands: PaperDataQualityPerformance["band"][] = [
    "complete",
    "partial",
    "unavailable",
    "unknown",
  ];

  return bands.map((band) => {
    const scoped = outcomes.filter((outcome) =>
      band === "unknown"
        ? !outcome.entryDataQuality
        : outcome.entryDataQuality?.status === band,
    );
    const wins = scoped.filter((outcome) => outcome.won).length;
    return {
      band,
      status: scoped.length >= MINIMUM_DATA_QUALITY_SAMPLES
        ? "monitoring"
        : "collecting",
      minimumSamples: MINIMUM_DATA_QUALITY_SAMPLES,
      maturedCount: scoped.length,
      winRate: scoped.length ? round((wins / scoped.length) * 100, 1) : 0,
      netPnlUsd: round(
        scoped.reduce((total, outcome) => total + outcome.netPnlUsd, 0),
      ),
      averageNetReturnPercent: scoped.length
        ? round(
          scoped.reduce(
            (total, outcome) => total + outcome.netReturnPercent,
            0,
          ) / scoped.length,
        )
        : 0,
    };
  });
}

export function calculateSourceQualityImpact(
  outcomes: PaperTradeOutcome[],
): PaperSourceQualityImpact[] {
  const evidenced = outcomes.filter((outcome) => outcome.entryDataQuality);

  return DATA_SOURCE_IDS.map((source) => {
    const impaired = evidenced.filter((outcome) =>
      outcome.entryDataQuality?.degradedSources.includes(source) ||
      outcome.entryDataQuality?.unavailableSources.includes(source),
    );
    const clean = evidenced.filter((outcome) =>
      !outcome.entryDataQuality?.degradedSources.includes(source) &&
      !outcome.entryDataQuality?.unavailableSources.includes(source),
    );
    const averageReturn = (scoped: PaperTradeOutcome[]) => scoped.length
      ? round(
        scoped.reduce(
          (total, outcome) => total + outcome.netReturnPercent,
          0,
        ) / scoped.length,
      )
      : 0;
    const cleanAverageNetReturnPercent = averageReturn(clean);
    const impairedAverageNetReturnPercent = averageReturn(impaired);
    const impairedNetPnlUsd = round(
      impaired.reduce((total, outcome) => total + outcome.netPnlUsd, 0),
    );
    const enoughSamples =
      clean.length >= MINIMUM_DATA_QUALITY_SAMPLES &&
      impaired.length >= MINIMUM_DATA_QUALITY_SAMPLES;
    const returnGapPercentagePoints = round(
      impairedAverageNetReturnPercent - cleanAverageNetReturnPercent,
    );
    const status = !enoughSamples
      ? "collecting"
      : impairedNetPnlUsd < 0 &&
          returnGapPercentagePoints <= DATA_QUALITY_ALERT_GAP_PERCENTAGE_POINTS
        ? "performance-alert"
        : "monitoring";

    return {
      source,
      status,
      minimumSamples: MINIMUM_DATA_QUALITY_SAMPLES,
      cleanCount: clean.length,
      impairedCount: impaired.length,
      cleanAverageNetReturnPercent,
      impairedAverageNetReturnPercent,
      returnGapPercentagePoints,
      impairedNetPnlUsd,
    };
  });
}

export function collectPaperTradeOutcomes(
  inputRecords: PaperScanRecord[],
  nowMs = Date.now(),
): PaperTradeOutcome[] {
  const analyticsWindowStart =
    nowMs - JOURNAL_ANALYTICS_WINDOW_DAYS * ONE_DAY_MS;
  const recordWindowStart =
    nowMs - JOURNAL_RECORD_WINDOW_DAYS * ONE_DAY_MS;
  const records = inputRecords
    .filter(
      (record) =>
        record.schemaVersion === 1 &&
        record.executionLocked === true &&
        record.bucketTimeMs >= recordWindowStart &&
        record.bucketTimeMs <= nowMs,
    )
    .toSorted((left, right) => left.bucketTimeMs - right.bucketTimeMs);

  return selectIndependentSignals(records)
    .map((candidate) => settleSignal(candidate, records))
    .filter((outcome): outcome is PaperTradeOutcome => outcome !== null)
    .filter((outcome) => outcomeTimeMs(outcome) >= analyticsWindowStart);
}

type SignalCandidate = {
  record: PaperScanRecord;
  signal: PaperSignalObservation;
};

function signalModel(signal: PaperSignalObservation): PaperSignalModel {
  return signal.model ?? "chart";
}

function emptyModelPerformance(model: PaperSignalModel): PaperModelPerformance {
  return {
    model,
    signalCount: 0,
    maturedCount: 0,
    pendingCount: 0,
    costGatePassedCount: 0,
    costGatePassRate: 0,
    winRate: 0,
    netPnlUsd: 0,
    averageNetReturnPercent: 0,
    profitFactor: null,
    maxDrawdownUsd: 0,
    maxDrawdownPercent: 0,
    longestLossStreak: 0,
    currentLossStreak: 0,
    qualification: {
      minimumSamples: MINIMUM_QUALIFICATION_SAMPLES,
      samplePassed: false,
      netProfitPassed: false,
      profitFactorPassed: false,
      drawdownPassed: false,
      costCoveragePassed: false,
      overallPassed: false,
    },
  };
}

function calculateModelPerformance(
  model: PaperSignalModel,
  candidates: SignalCandidate[],
  outcomes: PaperTradeOutcome[],
  startingCapital: number,
): PaperModelPerformance {
  const scopedCandidates = candidates.filter(
    ({ signal }) => signalModel(signal) === model,
  );
  const scopedOutcomes = outcomes.filter(
    (outcome) => signalModel(outcome) === model,
  );
  const maturedCount = scopedOutcomes.length;
  const wins = scopedOutcomes.filter((outcome) => outcome.won).length;
  const netPnlUsd = scopedOutcomes.reduce(
    (total, outcome) => total + outcome.netPnlUsd,
    0,
  );
  const grossProfit = scopedOutcomes
    .filter((outcome) => outcome.netPnlUsd > 0)
    .reduce((total, outcome) => total + outcome.netPnlUsd, 0);
  const grossLoss = Math.abs(
    scopedOutcomes
      .filter((outcome) => outcome.netPnlUsd <= 0)
      .reduce((total, outcome) => total + outcome.netPnlUsd, 0),
  );
  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0;
  let equity = startingCapital;
  let equityPeak = startingCapital;
  let maxDrawdownUsd = 0;
  let longestLossStreak = 0;
  let currentLossStreak = 0;

  for (const outcome of scopedOutcomes) {
    equity += outcome.netPnlUsd;
    equityPeak = Math.max(equityPeak, equity);
    maxDrawdownUsd = Math.max(maxDrawdownUsd, equityPeak - equity);
    if (outcome.won) {
      currentLossStreak = 0;
    } else {
      currentLossStreak += 1;
      longestLossStreak = Math.max(longestLossStreak, currentLossStreak);
    }
  }

  const maxDrawdownPercent =
    startingCapital > 0 ? (maxDrawdownUsd / startingCapital) * 100 : 0;
  const costGatePassedCount = scopedCandidates.filter(
    ({ signal }) => signal.costGatePassed,
  ).length;
  const costGatePassRate =
    scopedCandidates.length > 0
      ? (costGatePassedCount / scopedCandidates.length) * 100
      : 0;
  const samplePassed = maturedCount >= MINIMUM_QUALIFICATION_SAMPLES;
  const netProfitPassed = maturedCount > 0 && netPnlUsd > 0;
  const profitFactorPassed =
    maturedCount > 0 &&
    (profitFactor === null ? grossProfit > 0 : profitFactor >= MIN_PROFIT_FACTOR);
  const drawdownPassed =
    maturedCount > 0 && maxDrawdownPercent <= MAX_DRAWDOWN_PERCENT;
  const costCoveragePassed =
    maturedCount > 0 && costGatePassRate >= MIN_COST_GATE_COVERAGE_PERCENT;

  return {
    model,
    signalCount: scopedCandidates.length,
    maturedCount,
    pendingCount: Math.max(0, scopedCandidates.length - maturedCount),
    costGatePassedCount,
    costGatePassRate: round(costGatePassRate, 1),
    winRate: maturedCount > 0 ? round((wins / maturedCount) * 100, 1) : 0,
    netPnlUsd: round(netPnlUsd),
    averageNetReturnPercent:
      maturedCount > 0
        ? round(
            scopedOutcomes.reduce(
              (total, outcome) => total + outcome.netReturnPercent,
              0,
            ) / maturedCount,
          )
        : 0,
    profitFactor: profitFactor === null ? null : round(profitFactor),
    maxDrawdownUsd: round(maxDrawdownUsd),
    maxDrawdownPercent: round(maxDrawdownPercent),
    longestLossStreak,
    currentLossStreak,
    qualification: {
      minimumSamples: MINIMUM_QUALIFICATION_SAMPLES,
      samplePassed,
      netProfitPassed,
      profitFactorPassed,
      drawdownPassed,
      costCoveragePassed,
      overallPassed:
        samplePassed &&
        netProfitPassed &&
        profitFactorPassed &&
        drawdownPassed &&
        costCoveragePassed,
    },
  };
}

type OutcomeMetrics = Omit<
  PaperPeriodPerformance,
  "days"
> & {
  averageWinPercent: number;
  averageLossPercent: number;
  payoffRatio: number | null;
};

function calculateOutcomeMetrics(
  outcomes: PaperTradeOutcome[],
  startingCapital: number,
): OutcomeMetrics {
  const wins = outcomes.filter((outcome) => outcome.netPnlUsd > 0);
  const losses = outcomes.filter((outcome) => outcome.netPnlUsd <= 0);
  const grossProfit = wins.reduce((total, outcome) => total + outcome.netPnlUsd, 0);
  const grossLoss = Math.abs(
    losses.reduce((total, outcome) => total + outcome.netPnlUsd, 0),
  );
  const averageWinPercent = wins.length
    ? wins.reduce((total, outcome) => total + outcome.netReturnPercent, 0) /
      wins.length
    : 0;
  const averageLossPercent = losses.length
    ? losses.reduce((total, outcome) => total + outcome.netReturnPercent, 0) /
      losses.length
    : 0;
  let equity = startingCapital;
  let peak = startingCapital;
  let maxDrawdownUsd = 0;

  for (const outcome of outcomes) {
    equity += outcome.netPnlUsd;
    peak = Math.max(peak, equity);
    maxDrawdownUsd = Math.max(maxDrawdownUsd, peak - equity);
  }

  return {
    maturedCount: outcomes.length,
    winRate: outcomes.length ? round((wins.length / outcomes.length) * 100, 1) : 0,
    netPnlUsd: round(outcomes.reduce((total, outcome) => total + outcome.netPnlUsd, 0)),
    averageNetReturnPercent: outcomes.length
      ? round(
          outcomes.reduce((total, outcome) => total + outcome.netReturnPercent, 0) /
            outcomes.length,
        )
      : 0,
    profitFactor:
      grossLoss > 0
        ? round(grossProfit / grossLoss)
        : grossProfit > 0
          ? null
          : 0,
    maxDrawdownPercent:
      startingCapital > 0 ? round((maxDrawdownUsd / startingCapital) * 100) : 0,
    averageWinPercent: round(averageWinPercent),
    averageLossPercent: round(averageLossPercent),
    payoffRatio:
      wins.length && losses.length && averageLossPercent !== 0
        ? round(averageWinPercent / Math.abs(averageLossPercent))
        : null,
  };
}

function outcomeTimeMs(outcome: PaperTradeOutcome): number {
  const parsed = Date.parse(outcome.outcomeTime);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function periodPerformance(
  outcomes: PaperTradeOutcome[],
  nowMs: number,
  startingCapital: number,
): PaperPeriodPerformance[] {
  return ([1, 7, 30] as const).map((days) => {
    const cutoff = nowMs - days * 24 * 60 * 60 * 1_000;
    const metrics = calculateOutcomeMetrics(
      outcomes.filter((outcome) => outcomeTimeMs(outcome) >= cutoff),
      startingCapital,
    );
    return {
      days,
      maturedCount: metrics.maturedCount,
      winRate: metrics.winRate,
      netPnlUsd: metrics.netPnlUsd,
      averageNetReturnPercent: metrics.averageNetReturnPercent,
      profitFactor: metrics.profitFactor,
      maxDrawdownPercent: metrics.maxDrawdownPercent,
    };
  });
}

function driftWindowMetrics(
  outcomes: PaperTradeOutcome[],
  startingCapital: number,
): PaperDriftPerformance["recent"] {
  const metrics = calculateOutcomeMetrics(outcomes, startingCapital);
  return {
    maturedCount: metrics.maturedCount,
    winRate: metrics.winRate,
    netPnlUsd: metrics.netPnlUsd,
    averageNetReturnPercent: metrics.averageNetReturnPercent,
    profitFactor: metrics.profitFactor,
    maxDrawdownPercent: metrics.maxDrawdownPercent,
  };
}

function driftPerformance(
  outcomes: PaperTradeOutcome[],
  nowMs: number,
  startingCapital: number,
): PaperDriftPerformance {
  const window = (anchorMs: number) => {
    const recentCutoff = anchorMs - 7 * 24 * 60 * 60 * 1_000;
    const baselineCutoff = anchorMs - 30 * 24 * 60 * 60 * 1_000;
    return {
      recent: driftWindowMetrics(
        outcomes.filter((outcome) => {
          const timestamp = outcomeTimeMs(outcome);
          return timestamp >= recentCutoff && timestamp <= anchorMs;
        }),
        startingCapital,
      ),
      baseline: driftWindowMetrics(
        outcomes.filter((outcome) => {
          const timestamp = outcomeTimeMs(outcome);
          return timestamp >= baselineCutoff && timestamp < recentCutoff;
        }),
        startingCapital,
      ),
    };
  };
  const current = window(nowMs);
  const confirmation = window(nowMs - 12 * 60 * 60 * 1_000);
  return {
    ...current,
    confirmation: {
      offsetHours: 12,
      ...confirmation,
    },
  };
}

function assetPerformance(
  outcomes: PaperTradeOutcome[],
  startingCapital: number,
): PaperAssetPerformance[] {
  const bySymbol = new Map<string, PaperTradeOutcome[]>();
  for (const outcome of outcomes) {
    const bucket = bySymbol.get(outcome.symbol) ?? [];
    bucket.push(outcome);
    bySymbol.set(outcome.symbol, bucket);
  }

  return [...bySymbol.entries()]
    .map(([symbol, scopedOutcomes]) => {
      const metrics = calculateOutcomeMetrics(scopedOutcomes, startingCapital);
      return {
        symbol,
        maturedCount: metrics.maturedCount,
        winRate: metrics.winRate,
        netPnlUsd: metrics.netPnlUsd,
        averageNetReturnPercent: metrics.averageNetReturnPercent,
        profitFactor: metrics.profitFactor,
      };
    })
    .toSorted(
      (left, right) =>
        right.netPnlUsd - left.netPnlUsd ||
        right.maturedCount - left.maturedCount ||
        left.symbol.localeCompare(right.symbol),
    )
    .slice(0, 6);
}

export function calculateConfidenceCalibration(
  outcomes: PaperTradeOutcome[],
  model: PaperSignalModel,
): PaperConfidenceCalibration {
  const definitions = [
    { band: "low", minimumConfidence: 0, maximumConfidence: 49 },
    { band: "medium", minimumConfidence: 50, maximumConfidence: 69 },
    { band: "high", minimumConfidence: 70, maximumConfidence: 100 },
  ] as const;
  const bands: PaperConfidenceBandPerformance[] = definitions.map((definition) => {
    const scoped = outcomes.filter((outcome) => {
      const confidence = Math.max(0, Math.min(100, outcome.confidence));
      if (definition.band === "low") return confidence < 50;
      if (definition.band === "medium") return confidence >= 50 && confidence < 70;
      return confidence >= 70;
    });
    const metrics = calculateOutcomeMetrics(scoped, 0);
    return {
      ...definition,
      maturedCount: metrics.maturedCount,
      winRate: metrics.winRate,
      netPnlUsd: metrics.netPnlUsd,
      averageNetReturnPercent: metrics.averageNetReturnPercent,
    };
  });
  const high = bands.find((band) => band.band === "high")!;
  const lowerOutcomes = outcomes.filter(
    (outcome) => Math.max(0, Math.min(100, outcome.confidence)) < 70,
  );
  const lower = calculateOutcomeMetrics(lowerOutcomes, 0);
  if (
    high.maturedCount < MINIMUM_CALIBRATION_SAMPLES ||
    lower.maturedCount < MINIMUM_CALIBRATION_SAMPLES
  ) {
    return {
      model,
      status: "collecting",
      minimumSamplesPerGroup: MINIMUM_CALIBRATION_SAMPLES,
      highConfidencePremiumPercentagePoints: null,
      bands,
      reasons: [
        `高確信度 ${high.maturedCount}/${MINIMUM_CALIBRATION_SAMPLES}件・70未満 ${lower.maturedCount}/${MINIMUM_CALIBRATION_SAMPLES}件を収集中`,
      ],
      researchOnly: true,
    };
  }

  const premium = round(
    high.averageNetReturnPercent - lower.averageNetReturnPercent,
  );
  const inverted = high.netPnlUsd < 0 && premium <= -1;
  return {
    model,
    status: inverted ? "inverted" : "aligned",
    minimumSamplesPerGroup: MINIMUM_CALIBRATION_SAMPLES,
    highConfidencePremiumPercentagePoints: premium,
    bands,
    reasons: [
      inverted
        ? `高確信度帯の平均リターンが70未満を${Math.abs(premium).toFixed(2)}ポイント下回り、損益もマイナスです。`
        : "高確信度帯に重大な逆転は検出されませんでした。",
    ],
    researchOnly: true,
  };
}

export function calculateRegimePerformance(
  outcomes: PaperTradeOutcome[],
): PaperRegimePerformance[] {
  const regimes = [
    "uptrend",
    "downtrend",
    "range",
    "high-volatility",
    "low-liquidity",
  ] as const;

  return regimes.map((regime) => {
    const metrics = calculateOutcomeMetrics(
      outcomes.filter((outcome) => outcome.marketRegime === regime),
      0,
    );
    const samplePassed = metrics.maturedCount >= MINIMUM_REGIME_SAMPLES;
    const returnAlert =
      metrics.averageNetReturnPercent <= REGIME_ALERT_AVERAGE_RETURN_PERCENT;
    const profitFactorAlert =
      metrics.profitFactor !== null &&
      metrics.profitFactor < REGIME_ALERT_PROFIT_FACTOR;
    const alert =
      samplePassed &&
      metrics.netPnlUsd < 0 &&
      (returnAlert || profitFactorAlert);
    const reasons = !samplePassed
      ? [
          `局面別アラート判定用の採点を${metrics.maturedCount}/${MINIMUM_REGIME_SAMPLES}件収集中です。`,
        ]
      : alert
        ? [
            `30日損益がマイナスで、${returnAlert ? "平均リターン" : "Profit Factor"}が警戒ラインを下回りました。`,
          ]
        : ["30日局面成績に警戒条件は検出されませんでした。"];
    return {
      regime,
      maturedCount: metrics.maturedCount,
      winRate: metrics.winRate,
      netPnlUsd: metrics.netPnlUsd,
      averageNetReturnPercent: metrics.averageNetReturnPercent,
      profitFactor: metrics.profitFactor,
      minimumSamples: MINIMUM_REGIME_SAMPLES,
      status: !samplePassed ? "collecting" : alert ? "alert" : "monitoring",
      alert,
      limits: {
        averageNetReturnPercent: REGIME_ALERT_AVERAGE_RETURN_PERCENT,
        profitFactor: REGIME_ALERT_PROFIT_FACTOR,
      },
      reasons,
      researchOnly: true,
    };
  });
}

function performanceTimeline(
  outcomes: PaperTradeOutcome[],
  nowMs: number,
): PaperPerformanceTimelinePoint[] {
  const pnlByDate = new Map<string, { tradeCount: number; netPnlUsd: number }>();
  for (const outcome of outcomes) {
    const time = outcomeTimeMs(outcome);
    if (!Number.isFinite(time)) continue;
    const date = new Date(time).toISOString().slice(0, 10);
    const current = pnlByDate.get(date) ?? { tradeCount: 0, netPnlUsd: 0 };
    current.tradeCount += 1;
    current.netPnlUsd += outcome.netPnlUsd;
    pnlByDate.set(date, current);
  }

  let cumulativeNetPnlUsd = 0;
  return Array.from({ length: JOURNAL_ANALYTICS_WINDOW_DAYS }, (_, index) => {
    const daysAgo = JOURNAL_ANALYTICS_WINDOW_DAYS - 1 - index;
    const date = new Date(nowMs - daysAgo * 24 * 60 * 60 * 1_000)
      .toISOString()
      .slice(0, 10);
    const daily = pnlByDate.get(date) ?? { tradeCount: 0, netPnlUsd: 0 };
    cumulativeNetPnlUsd += daily.netPnlUsd;
    return {
      date,
      tradeCount: daily.tradeCount,
      netPnlUsd: round(daily.netPnlUsd),
      cumulativeNetPnlUsd: round(cumulativeNetPnlUsd),
    };
  });
}

export function emptyPaperJournal(
  status: "disabled" | "error",
  message: string,
): PaperJournalSnapshot {
  return {
    status,
    storageConfigured: status !== "disabled",
    executionLocked: true,
    windowDays: JOURNAL_WINDOW_DAYS,
    analyticsWindowDays: JOURNAL_ANALYTICS_WINDOW_DAYS,
    horizonHours: OUTCOME_HORIZON_HOURS,
    startedAt: null,
    lastScanAt: null,
    scanCount: 0,
    signalCount: 0,
    maturedCount: 0,
    pendingCount: 0,
    costGatePassedCount: 0,
    costGatePassRate: 0,
    winRate: 0,
    netPnlUsd: 0,
    dailyNetPnlUsd: 0,
    dailyLossPercent: 0,
    averageNetReturnPercent: 0,
    profitFactor: null,
    maxDrawdownUsd: 0,
    maxDrawdownPercent: 0,
    longestLossStreak: 0,
    currentLossStreak: 0,
    operationalReadiness: {
      status: "collecting",
      minimumObservationHours: MINIMUM_OBSERVATION_HOURS,
      observationHours: 0,
      observationPassed: false,
      minimumScanCoveragePercent: MINIMUM_SCAN_COVERAGE_PERCENT,
      scanCoverage24hPercent: 0,
      scanCoveragePassed: false,
      latestScanFresh: false,
      overallPassed: false,
      reasons: [message],
    },
    averageWinPercent: 0,
    averageLossPercent: 0,
    payoffRatio: null,
    qualification: {
      minimumSamples: MINIMUM_QUALIFICATION_SAMPLES,
      samplePassed: false,
      netProfitPassed: false,
      profitFactorPassed: false,
      drawdownPassed: false,
      costCoveragePassed: false,
      overallPassed: false,
    },
    modelPerformance: {
      chart: emptyModelPerformance("chart"),
      "community-trend": emptyModelPerformance("community-trend"),
    },
    periodPerformance: ([1, 7, 30] as const).map((days) => ({
      days,
      maturedCount: 0,
      winRate: 0,
      netPnlUsd: 0,
      averageNetReturnPercent: 0,
      profitFactor: null,
      maxDrawdownPercent: 0,
    })),
    periodPerformanceByModel: {
      chart: ([1, 7, 30] as const).map((days) => ({
        days,
        maturedCount: 0,
        winRate: 0,
        netPnlUsd: 0,
        averageNetReturnPercent: 0,
        profitFactor: null,
        maxDrawdownPercent: 0,
      })),
      "community-trend": ([1, 7, 30] as const).map((days) => ({
        days,
        maturedCount: 0,
        winRate: 0,
        netPnlUsd: 0,
        averageNetReturnPercent: 0,
        profitFactor: null,
        maxDrawdownPercent: 0,
      })),
    },
    driftPerformanceByModel: {
      chart: {
        recent: driftWindowMetrics([], 0),
        baseline: driftWindowMetrics([], 0),
      },
      "community-trend": {
        recent: driftWindowMetrics([], 0),
        baseline: driftWindowMetrics([], 0),
      },
    },
    confidenceCalibrationByModel: {
      chart: calculateConfidenceCalibration([], "chart"),
      "community-trend": calculateConfidenceCalibration([], "community-trend"),
    },
    regimePerformance: calculateRegimePerformance([]),
    assetPerformance: [],
    performanceTimeline: [],
    dataSourceQualityHistory24h: calculateDataSourceQualityHistory([]),
    dataSourceIncidents24h: calculateDataSourceIncidents([]),
    dataQualityPerformance: calculateDataQualityPerformance([]),
    sourceQualityImpact: calculateSourceQualityImpact([]),
    recentOutcomes: [],
    message,
  };
}

export function evaluatePaperJournal(
  inputRecords: PaperScanRecord[],
  nowMs = Date.now(),
): PaperJournalSnapshot {
  const recordWindowStart =
    nowMs - JOURNAL_RECORD_WINDOW_DAYS * 24 * 60 * 60 * 1_000;
  const analyticsRecords = inputRecords
    .filter(
      (record) =>
        record.schemaVersion === 1 &&
        record.executionLocked === true &&
        record.bucketTimeMs >= recordWindowStart &&
        record.bucketTimeMs <= nowMs,
    )
    .toSorted((left, right) => left.bucketTimeMs - right.bucketTimeMs);
  const windowStart = nowMs - JOURNAL_WINDOW_DAYS * 24 * 60 * 60 * 1_000;
  const records = analyticsRecords.filter(
    (record) => record.bucketTimeMs >= windowStart,
  );
  const candidates = selectIndependentSignals(records);
  const outcomes = candidates
    .map((candidate) => settleSignal(candidate, records))
    .filter((outcome): outcome is PaperTradeOutcome => outcome !== null);
  const allAnalyticsOutcomes = collectPaperTradeOutcomes(analyticsRecords, nowMs);
  const analyticsOutcomes = allAnalyticsOutcomes.filter(
    (outcome) => signalModel(outcome) === "chart",
  );
  const communityAnalyticsOutcomes = allAnalyticsOutcomes.filter(
    (outcome) => signalModel(outcome) === "community-trend",
  );
  const startingCapital = records[0]?.portfolioValueUsd ?? 0;
  const analyticsStartingCapital =
    analyticsRecords[0]?.portfolioValueUsd ?? startingCapital;
  const analyticsMetrics = calculateOutcomeMetrics(
    analyticsOutcomes,
    analyticsStartingCapital,
  );
  const chart = calculateModelPerformance(
    "chart",
    candidates,
    outcomes,
    startingCapital,
  );
  const communityTrend = calculateModelPerformance(
    "community-trend",
    candidates,
    outcomes,
    startingCapital,
  );
  const operationalReadiness = calculateOperationalReadiness(
    analyticsRecords,
    nowMs,
    chart.qualification,
  );
  const status = operationalReadiness.status === "ready"
    ? "qualified"
    : operationalReadiness.status === "collecting"
      ? "collecting"
      : "rejected";
  const dailyNetPnlUsd = outcomes
    .filter((outcome) => {
      const outcomeTime = Date.parse(outcome.outcomeTime);
      return Number.isFinite(outcomeTime) && outcomeTime >= nowMs - 24 * 60 * 60 * 1_000;
    })
    .reduce((total, outcome) => total + outcome.netPnlUsd, 0);
  const dailyLossPercent =
    startingCapital > 0 && dailyNetPnlUsd < 0
      ? (Math.abs(dailyNetPnlUsd) / startingCapital) * 100
      : 0;

  return {
    status,
    storageConfigured: true,
    executionLocked: true,
    windowDays: JOURNAL_WINDOW_DAYS,
    analyticsWindowDays: JOURNAL_ANALYTICS_WINDOW_DAYS,
    horizonHours: OUTCOME_HORIZON_HOURS,
    startedAt: analyticsRecords[0]?.generatedAt ?? null,
    lastScanAt: records.at(-1)?.generatedAt ?? null,
    scanCount: records.length,
    signalCount: chart.signalCount,
    maturedCount: chart.maturedCount,
    pendingCount: chart.pendingCount,
    costGatePassedCount: chart.costGatePassedCount,
    costGatePassRate: chart.costGatePassRate,
    winRate: chart.winRate,
    netPnlUsd: chart.netPnlUsd,
    dailyNetPnlUsd: round(dailyNetPnlUsd),
    dailyLossPercent: round(dailyLossPercent),
    averageNetReturnPercent: chart.averageNetReturnPercent,
    profitFactor: chart.profitFactor,
    maxDrawdownUsd: chart.maxDrawdownUsd,
    maxDrawdownPercent: chart.maxDrawdownPercent,
    longestLossStreak: chart.longestLossStreak,
    currentLossStreak: chart.currentLossStreak,
    operationalReadiness,
    averageWinPercent: analyticsMetrics.averageWinPercent,
    averageLossPercent: analyticsMetrics.averageLossPercent,
    payoffRatio: analyticsMetrics.payoffRatio,
    qualification: chart.qualification,
    modelPerformance: {
      chart,
      "community-trend": communityTrend,
    },
    periodPerformance: periodPerformance(
      analyticsOutcomes,
      nowMs,
      analyticsStartingCapital,
    ),
    periodPerformanceByModel: {
      chart: periodPerformance(
        analyticsOutcomes,
        nowMs,
        analyticsStartingCapital,
      ),
      "community-trend": periodPerformance(
        communityAnalyticsOutcomes,
        nowMs,
        analyticsStartingCapital,
      ),
    },
    driftPerformanceByModel: {
      chart: driftPerformance(
        analyticsOutcomes,
        nowMs,
        analyticsStartingCapital,
      ),
      "community-trend": driftPerformance(
        communityAnalyticsOutcomes,
        nowMs,
        analyticsStartingCapital,
      ),
    },
    confidenceCalibrationByModel: {
      chart: calculateConfidenceCalibration(analyticsOutcomes, "chart"),
      "community-trend": calculateConfidenceCalibration(
        communityAnalyticsOutcomes,
        "community-trend",
      ),
    },
    regimePerformance: calculateRegimePerformance(analyticsOutcomes),
    assetPerformance: assetPerformance(
      analyticsOutcomes,
      analyticsStartingCapital,
    ),
    performanceTimeline: performanceTimeline(analyticsOutcomes, nowMs),
    dataSourceQualityHistory24h: calculateDataSourceQualityHistory(
      analyticsRecords,
      nowMs,
    ),
    dataSourceIncidents24h: calculateDataSourceIncidents(
      analyticsRecords,
      nowMs,
    ),
    dataQualityPerformance: calculateDataQualityPerformance(
      analyticsOutcomes,
    ),
    sourceQualityImpact: calculateSourceQualityImpact(analyticsOutcomes),
    recentOutcomes: outcomes
      .filter((outcome) => signalModel(outcome) === "chart")
      .toReversed()
      .slice(0, 6),
    message:
      records.length === 0
        ? "最初の5分スキャンを待っています。"
        : operationalReadiness.status === "collecting"
          ? `7日間の連続観測と6時間後採点を収集中です（${chart.maturedCount}/${MINIMUM_QUALIFICATION_SAMPLES}件）。`
          : operationalReadiness.status === "ready"
            ? "運用品質と全ての昇格条件を通過しました。実売買は引き続きロック中です。"
            : operationalReadiness.reasons[0] ?? "運用準備度が昇格条件を満たしていません。",
  };
}
