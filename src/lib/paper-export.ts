import type { PaperTradeOutcome } from "@/lib/types";

const CSV_HEADERS = [
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

function safeText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number | boolean | undefined): string {
  const normalized =
    typeof value === "number"
      ? Number.isFinite(value) ? String(value) : ""
      : typeof value === "string" ? safeText(value) : String(value ?? "");
  return /[",\r\n]/.test(normalized)
    ? `"${normalized.replaceAll('"', '""')}"`
    : normalized;
}

export function buildPaperOutcomeCsv(outcomes: PaperTradeOutcome[]): string {
  const rows = outcomes.map((outcome) => [
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
  ].map(csvCell).join(","));

  return `\uFEFF${[CSV_HEADERS.join(","), ...rows].join("\r\n")}\r\n`;
}

export function paperOutcomeExportFilename(now = new Date()): string {
  const date = Number.isFinite(now.getTime())
    ? now.toISOString().slice(0, 10)
    : "unknown-date";
  return `sumi-paper-outcomes-${date}.csv`;
}
