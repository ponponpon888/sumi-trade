import type {
  ChartModelSnapshot,
  PaperJournalSnapshot,
  PaperModelPerformance,
  PaperScanRecord,
  PaperSignalModel,
  PaperSignalObservation,
  PaperTradeOutcome,
  PortfolioSnapshot,
  StrategyPlan,
  TrendScoutSnapshot,
} from "@/lib/types";

export const JOURNAL_WINDOW_DAYS = 7 as const;
export const OUTCOME_HORIZON_HOURS = 6 as const;
export const MINIMUM_QUALIFICATION_SAMPLES = 30;

const SCAN_BUCKET_MS = 5 * 60 * 1_000;
const SIGNAL_COOLDOWN_MS = OUTCOME_HORIZON_HOURS * 60 * 60 * 1_000;
const OUTCOME_HORIZON_MS = OUTCOME_HORIZON_HOURS * 60 * 60 * 1_000;
const MAX_OUTCOME_DELAY_MS = 90 * 60 * 1_000;
const MIN_PROFIT_FACTOR = 1.2;
const MAX_DRAWDOWN_PERCENT = 8;
const MIN_COST_GATE_COVERAGE_PERCENT = 70;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
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
  const prices: Record<string, number> = {};
  const planBySymbol = new Map(
    data.plan.signals.map((signal) => [signal.symbol, signal]),
  );
  const signals: PaperSignalObservation[] = [];

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
      model: "chart",
      priceKey: analysis.symbol,
      symbol: analysis.symbol,
      direction: analysis.direction,
      entryPriceUsd: analysis.lastPrice,
      modelScore: analysis.score,
      confidence: analysis.confidence,
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
    prices[priceKey] = rotation.entryPriceUsd;
    signals.push({
      model: "community-trend",
      priceKey,
      contractAddress: priceKey,
      symbol: rotation.toSymbol,
      direction: "BUY",
      entryPriceUsd: rotation.entryPriceUsd,
      modelScore: rotation.score,
      confidence: rotation.score,
      notionalUsd: rotation.amountUsd,
      estimatedCostUsd: rotation.estimatedRoundTripCostUsd,
      costGatePassed: rotation.costGatePassed,
    });
  }

  return {
    schemaVersion: 1,
    id: bucketId(bucketTimeMs),
    bucketTimeMs,
    generatedAt: new Date(nowMs).toISOString(),
    walletAddress: data.snapshot.walletAddress.toLowerCase(),
    portfolioValueUsd: round(data.snapshot.totalUsd),
    executionLocked: true,
    prices,
    signals,
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

  for (const record of records) {
    for (const signal of record.signals) {
      const key = `${signal.model ?? "chart"}:${signal.priceKey ?? signal.symbol}:${signal.direction}`;
      const previous = lastSignalAt.get(key) ?? Number.NEGATIVE_INFINITY;
      if (record.bucketTimeMs - previous < SIGNAL_COOLDOWN_MS) continue;
      selected.push({ record, signal });
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
    signalTime: candidate.record.generatedAt,
    outcomeTime: outcomeRecord.generatedAt,
    exitPriceUsd: exitPrice,
    grossReturnPercent: round(grossReturnPercent),
    netReturnPercent: round(netReturnPercent),
    netPnlUsd: round(netPnlUsd),
    won: netPnlUsd > 0,
  };
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

export function emptyPaperJournal(
  status: "disabled" | "error",
  message: string,
): PaperJournalSnapshot {
  return {
    status,
    storageConfigured: status !== "disabled",
    executionLocked: true,
    windowDays: JOURNAL_WINDOW_DAYS,
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
    recentOutcomes: [],
    message,
  };
}

export function evaluatePaperJournal(
  inputRecords: PaperScanRecord[],
  nowMs = Date.now(),
): PaperJournalSnapshot {
  const windowStart = nowMs - JOURNAL_WINDOW_DAYS * 24 * 60 * 60 * 1_000;
  const records = inputRecords
    .filter(
      (record) =>
        record.schemaVersion === 1 &&
        record.executionLocked === true &&
        record.bucketTimeMs >= windowStart &&
        record.bucketTimeMs <= nowMs,
    )
    .toSorted((left, right) => left.bucketTimeMs - right.bucketTimeMs);
  const candidates = selectIndependentSignals(records);
  const outcomes = candidates
    .map((candidate) => settleSignal(candidate, records))
    .filter((outcome): outcome is PaperTradeOutcome => outcome !== null);
  const startingCapital = records[0]?.portfolioValueUsd ?? 0;
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
  const status = !chart.qualification.samplePassed
    ? "collecting"
    : chart.qualification.overallPassed
      ? "qualified"
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
    horizonHours: OUTCOME_HORIZON_HOURS,
    startedAt: records[0]?.generatedAt ?? null,
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
    qualification: chart.qualification,
    modelPerformance: {
      chart,
      "community-trend": communityTrend,
    },
    recentOutcomes: outcomes
      .filter((outcome) => signalModel(outcome) === "chart")
      .toReversed()
      .slice(0, 6),
    message:
      records.length === 0
        ? "最初の5分スキャンを待っています。"
        : !chart.qualification.samplePassed
          ? `6時間後採点を収集中です（${chart.maturedCount}/${MINIMUM_QUALIFICATION_SAMPLES}件）。`
          : chart.qualification.overallPassed
            ? "全ての昇格条件を通過しました。実売買は引き続きロック中です。"
            : "サンプルは揃いましたが、昇格条件を満たしていません。モデル調整が必要です。",
  };
}
