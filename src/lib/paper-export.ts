import type {
  PaperJournalSnapshot,
  PaperRegimePerformance,
  PaperTradeOutcome,
} from "@/lib/types";

export type PaperExportDataset =
  | "outcomes"
  | "confidence"
  | "regimes"
  | "research";
export type PaperExportFormat = "csv" | "json";

export interface PaperExportSelection {
  dataset: PaperExportDataset;
  format: PaperExportFormat;
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
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
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
): string {
  return `\uFEFF${[
    headers.join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\r\n")}\r\n`;
}

export function buildPaperOutcomeCsv(outcomes: PaperTradeOutcome[]): string {
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
  );
}

export function buildPaperConfidenceCsv(
  calibrations: PaperJournalSnapshot["confidenceCalibrationByModel"],
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
  );
}

export function buildPaperRegimeCsv(
  performances: PaperRegimePerformance[],
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
  );
}

export function buildPaperResearchJson(
  outcomes: PaperTradeOutcome[],
  journal: Pick<
    PaperJournalSnapshot,
    | "analyticsWindowDays"
    | "confidenceCalibrationByModel"
    | "regimePerformance"
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
      analyticsWindowDays: journal.analyticsWindowDays,
      executionLocked: true,
      researchOnly: true,
      confidenceCalibrationByModel: journal.confidenceCalibrationByModel,
      regimePerformance: journal.regimePerformance,
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
        ["outcomes", "confidence", "regimes"].includes(dataset)) ||
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
