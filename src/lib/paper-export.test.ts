import { describe, expect, it } from "vitest";

import {
  buildPaperOutcomeCsv,
  paperOutcomeExportFilename,
} from "@/lib/paper-export";
import type { PaperTradeOutcome } from "@/lib/types";

function outcome(patch: Partial<PaperTradeOutcome> = {}): PaperTradeOutcome {
  return {
    decisionId: "decision-1",
    model: "chart",
    priceKey: "SUMI",
    symbol: "SUMI",
    direction: "BUY",
    entryPriceUsd: 1,
    modelScore: 72,
    confidence: 68,
    marketRegime: "uptrend",
    decisionReasons: ["5分・15分・1時間が上向き", "コストゲート通過"],
    notionalUsd: 50,
    estimatedCostUsd: 2,
    costGatePassed: true,
    signalTime: "2026-09-01T00:00:00.000Z",
    outcomeTime: "2026-09-01T06:00:00.000Z",
    exitPriceUsd: 1.1,
    grossReturnPercent: 10,
    netReturnPercent: 6,
    netPnlUsd: 3,
    won: true,
    ...patch,
  };
}

describe("paper outcome CSV", () => {
  it("exports an Excel-compatible audit row with execution locked", () => {
    const csv = buildPaperOutcomeCsv([outcome()]);

    expect(csv.startsWith("\uFEFFsignal_time,")).toBe(true);
    expect(csv).toContain(
      "decision-1,SUMI,BUY,72,68,uptrend,5分・15分・1時間が上向き | コストゲート通過,1,1.1,50,2,10,6,3,true,true,true",
    );
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("escapes CSV delimiters and neutralizes spreadsheet formulas", () => {
    const csv = buildPaperOutcomeCsv([
      outcome({ decisionId: '=HYPERLINK("https://invalid")', symbol: "A,B" }),
    ]);

    expect(csv).toContain('"\'=HYPERLINK(""https://invalid"")"');
    expect(csv).toContain('"A,B"');
  });

  it("creates a deterministic dated filename", () => {
    expect(paperOutcomeExportFilename(new Date("2026-09-08T23:59:59Z"))).toBe(
      "sumi-paper-outcomes-2026-09-08.csv",
    );
  });
});
