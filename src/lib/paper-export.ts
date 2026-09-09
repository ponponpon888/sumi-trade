import type {
  PaperJournalSnapshot,
  PaperRegimePerformance,
  PaperTradeOutcome,
} from "@/lib/types";

export type PaperExportDataset =
  | "outcomes"
  | "confidence"
  | "regimes"
  | "data-quality"
  | "source-impact"
  | "source-reasons"
  | "research";
export type PaperExportFormat = "csv" | "json";

export interface PaperExportSelection {
  dataset: PaperExportDataset;
  format: PaperExportFormat;
}

export interface PaperExportContext {
  asOf: string;
  windowStart: string;
  windowEnd: string;
  timeBasis: "outcome_time";
}

export function createPaperExportContext(
  asOf: Date,
  analyticsWindowDays: number,
): PaperExportContext {
  const end = asOf.getTime();
  if (!Number.isFinite(end) || !Number.isFinite(analyticsWindowDays) || analyticsWindowDays <= 0) {
    throw new Error("Invalid paper export period.");
  }
  return {
    asOf: asOf.toISOString(),
    windowStart: new Date(end - analyticsWindowDays * 86_400_000).toISOString(),
    windowEnd: asOf.toISOString(),
    timeBasis: "outcome_time",
  };
}

const OUTCOME_CSV_HEADERS = [
  "signal_time",
  "outcome_time",
  "model",
  "decision_id",
  "symbol",
  "direction",
  "model_score",
  "confidence",
  "market_regime",
  "decision_reasons",
  "entry_data_quality",
  "entry_data_coverage_percent",
  "entry_degraded_sources",
  "entry_unavailable_sources",
  "entry_price_usd",
  "exit_price_usd",
  "notional_usd",
  "estimated_cost_usd",
  "gross_return_percent",
  "net_return_percent",
  "net_pnl_usd",
  "cost_gate_passed",
  "won",
  "execution_locked",
] as const;

const CONFIDENCE_CSV_HEADERS = [
  "model",
  "calibration_status",
  "confidence_band",
  "minimum_confidence",
  "maximum_confidence",
  "matured_count",
  "win_rate",
  "net_pnl_usd",
  "average_net_return_percent",
  "high_confidence_premium_percentage_points",
  "research_only",
  "execution_locked",
] as const;

const REGIME_CSV_HEADERS = [
  "market_regime",
  "status",
  "matured_count",
  "win_rate",
  "net_pnl_usd",
  "average_net_return_percent",
  "profit_factor",
  "alert",
  "reason",
  "research_only",
  "execution_locked",
] as const;

function safeText(value: string): string {
  // Spreadsheet importers may ignore leading whitespace/control characters.
  // Preserve the source text while forcing potentially active cells to text.
  const unsafe = /^[\s\p{Cc}\p{Cf}]*[=+\-@]|^[\p{Cc}\p{Cf}]/u.test(value);
  return unsafe ? `'${value}` : value;
}

function csvCell(
  value: string | number | boolean | null | undefined,
): string {
  const normalized =
    typeof value === "number"
      ? Number.isFinite(value)
        ? String(value)
        : ""
      : typeof value === "string"
        ? safeText(value)
        : String(value ?? "");
  return /[",\r\n]/.test(normalized)
    ? `"${normalized.replaceAll('"', '""')}"`
    : normalized;
}

function buildCsv(
  headers: readonly string[],
  rows: Array<Array<string | number | boolean | null | undefined>>,
  context?: PaperExportContext,
): string {
  const metadataHeaders = context ? ["export_as_of", "window_start", "window_end", "window_time_basis"] : [];
  const metadata = context ? [context.asOf, context.windowStart, context.windowEnd, context.timeBasis] : [];
  return `\uFEFF${[
    [...headers, ...metadataHeaders].join(","),
    ...rows.map((row) => [...row, ...metadata].map(csvCell).join(",")),
  ].join("\r\n")}\r\n`;
}

export function buildPaperOutcomeCsv(outcomes: PaperTradeOutcome[], context?: PaperExportContext): string {
  return buildCsv(
    OUTCOME_CSV_HEADERS,
    outcomes.map((outcome) => [
      outcome.signalTime,
      outcome.outcomeTime,
      outcome.model ?? "chart",
      outcome.decisionId ?? "",
      outcome.symbol,
      outcome.direction,
      outcome.modelScore,
      outcome.confidence,
      outcome.marketRegime ?? "",
      outcome.decisionReasons?.join(" | ") ?? "",
      outcome.entryDataQuality?.status ?? "unknown",
      outcome.entryDataQuality?.averageCoveragePercent ?? "",
      outcome.entryDataQuality?.degradedSources.join(" | ") ?? "",
      outcome.entryDataQuality?.unavailableSources.join(" | ") ?? "",
      outcome.entryPriceUsd,
      outcome.exitPriceUsd,
      outcome.notionalUsd,
      outcome.estimatedCostUsd,
      outcome.grossReturnPercent,
      outcome.netReturnPercent,
      outcome.netPnlUsd,
      outcome.costGatePassed,
      outcome.won,
      true,
    ]),
    context,
  );
}

export function buildPaperConfidenceCsv(
  calibrations: PaperJournalSnapshot["confidenceCalibrationByModel"],
  context?: PaperExportContext,
): string {
  return buildCsv(
    CONFIDENCE_CSV_HEADERS,
    Object.values(calibrations).flatMap((calibration) =>
      calibration.bands.map((band) => [
        calibration.model,
        calibration.status,
        band.band,
        band.minimumConfidence,
        band.maximumConfidence,
        band.maturedCount,
        band.winRate,
        band.netPnlUsd,
        band.averageNetReturnPercent,
        calibration.highConfidencePremiumPercentagePoints,
        true,
        true,
      ]),
    ),
    context,
  );
}

export function buildPaperRegimeCsv(
  performances: PaperRegimePerformance[],
  context?: PaperExportContext,
): string {
  return buildCsv(
    REGIME_CSV_HEADERS,
    performances.map((performance) => [
      performance.regime,
      performance.status,
      performance.maturedCount,
      performance.winRate,
      performance.netPnlUsd,
      performance.averageNetReturnPercent,
      performance.profitFactor,
      performance.alert,
      performance.reasons.join(" | "),
      true,
      true,
    ]),
    context,
  );
}

export function buildPaperDataQualityCsv(
  performances: PaperJournalSnapshot["dataQualityPerformance"],
  context?: PaperExportContext,
): string {
  return buildCsv(
    ["quality_band", "status", "minimum_samples", "matured_count", "win_rate", "net_pnl_usd", "average_net_return_percent", "research_only", "execution_locked"],
    performances.map((item) => [item.band, item.status, item.minimumSamples, item.maturedCount, item.winRate, item.netPnlUsd, item.averageNetReturnPercent, true, true]),
    context,
  );
}

export function buildPaperSourceImpactCsv(
  impacts: PaperJournalSnapshot["sourceQualityImpact"] | PaperJournalSnapshot["sourceReasonImpact"],
  context?: PaperExportContext,
): string {
  return buildCsv(
    ["source", "status", "minimum_samples_per_group", "decision_reason", "clean_count", "impaired_count", "clean_average_net_return_percent", "impaired_average_net_return_percent", "return_gap_percentage_points", "impaired_net_pnl_usd", "research_only", "execution_locked"],
    impacts.map((item) => [item.source, item.status, item.minimumSamples, "reason" in item ? item.reason : null, item.cleanCount, item.impairedCount, item.cleanAverageNetReturnPercent, item.impairedAverageNetReturnPercent, item.returnGapPercentagePoints, item.impairedNetPnlUsd, true, true]),
    context,
  );
}

export function buildPaperResearchJson(
  outcomes: PaperTradeOutcome[],
  journal: Pick<
    PaperJournalSnapshot,
    | "analyticsWindowDays"
    | "confidenceCalibrationByModel"
    | "regimePerformance"
    | "dataQualityPerformance"
    | "sourceQualityImpact"
    | "sourceReasonImpact"
  >,
  generatedAt = new Date(),
): string {
  const timestamp = Number.isFinite(generatedAt.getTime())
    ? generatedAt.toISOString()
    : new Date(0).toISOString();
  return JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: timestamp,
      analysisWindow: createPaperExportContext(new Date(timestamp), journal.analyticsWindowDays),
      modelScope: {
        outcomes: "chart-and-community-trend",
        confidenceCalibrationByModel: "chart-and-community-trend",
        regimePerformance: "chart",
        dataQualityPerformance: "chart",
        sourceQualityImpact: "chart",
        sourceReasonImpact: "chart",
      },
      analyticsWindowDays: journal.analyticsWindowDays,
      executionLocked: true,
      researchOnly: true,
      confidenceCalibrationByModel: journal.confidenceCalibrationByModel,
      regimePerformance: journal.regimePerformance,
      dataQualityPerformance: journal.dataQualityPerformance,
      sourceQualityImpact: journal.sourceQualityImpact,
      sourceReasonImpact: journal.sourceReasonImpact,
      outcomes,
    },
    null,
    2,
  );
}

export function parsePaperExportRequest(
  url: string,
): PaperExportSelection | null {
  try {
    const params = new URL(url).searchParams;
    const format = params.get("format") ?? "csv";
    const dataset =
      params.get("dataset") ?? (format === "json" ? "research" : "outcomes");
    if (
      (format === "csv" &&
        ["outcomes", "confidence", "regimes", "data-quality", "source-impact", "source-reasons"].includes(dataset)) ||
      (format === "json" && dataset === "research")
    ) {
      return {
        dataset: dataset as PaperExportDataset,
        format: format as PaperExportFormat,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function paperResearchExportFilename(
  selection: PaperExportSelection,
  now = new Date(),
): string {
  const date = Number.isFinite(now.getTime())
    ? now.toISOString().slice(0, 10)
    : "unknown-date";
  return `sumi-paper-${selection.dataset}-${date}.${selection.format}`;
}

export function paperOutcomeExportFilename(now = new Date()): string {
  return paperResearchExportFilename(
    { dataset: "outcomes", format: "csv" },
    now,
  );
}
