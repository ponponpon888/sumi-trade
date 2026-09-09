import { describe, expect, it } from "vitest";

import {
  buildPaperConfidenceCsv,
  buildPaperDataQualityCsv,
  buildPaperSourceImpactCsv,
  buildPaperOutcomeCsv,
  buildPaperRegimeCsv,
  buildPaperResearchJson,
  paperOutcomeExportFilename,
  paperResearchExportFilename,
  parsePaperExportRequest,
} from "@/lib/paper-export";
import { calculateDataQualityPerformance, calculateSourceQualityImpact, calculateSourceReasonImpact } from "@/lib/paper-journal-core";
import type {
  PaperConfidenceCalibration,
  PaperRegimePerformance,
  PaperSignalModel,
  PaperTradeOutcome,
} from "@/lib/types";

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
    entryDataQuality: {
      status: "partial",
      averageCoveragePercent: 92,
      degradedSources: ["geckoterminal"],
      unavailableSources: [],
    },
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

function calibration(model: PaperSignalModel): PaperConfidenceCalibration {
  return {
    model,
    status: "aligned",
    minimumSamplesPerGroup: 10,
    highConfidencePremiumPercentagePoints: 1.25,
    bands: [
      {
        band: "high",
        minimumConfidence: 70,
        maximumConfidence: 100,
        maturedCount: 10,
        winRate: 60,
        netPnlUsd: 5,
        averageNetReturnPercent: 0.5,
      },
    ],
    reasons: ["重大な逆転なし"],
    researchOnly: true,
  };
}

function regime(): PaperRegimePerformance {
  return {
    regime: "uptrend",
    maturedCount: 10,
    winRate: 60,
    netPnlUsd: 5,
    averageNetReturnPercent: 0.5,
    profitFactor: 1.25,
    minimumSamples: 10,
    status: "monitoring",
    alert: false,
    limits: {
      averageNetReturnPercent: -1,
      profitFactor: 0.8,
    },
    reasons: ["重大な悪化なし"],
    researchOnly: true,
  };
}

describe("paper research export", () => {
  it("exports an Excel-compatible audit row with execution locked", () => {
    const csv = buildPaperOutcomeCsv([outcome()]);

    expect(csv.startsWith("\uFEFFsignal_time,")).toBe(true);
    expect(csv).toContain(
      "decision-1,SUMI,BUY,72,68,uptrend,5分・15分・1時間が上向き | コストゲート通過,partial,92,geckoterminal,,1,1.1,50,2,10,6,3,true,true,true",
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

  it("exports confidence calibration and regime alert summaries", () => {
    const confidenceCsv = buildPaperConfidenceCsv({
      chart: calibration("chart"),
      "community-trend": calibration("community-trend"),
    });
    const regimeCsv = buildPaperRegimeCsv([regime()]);

    expect(confidenceCsv).toContain(
      "chart,aligned,high,70,100,10,60,5,0.5,1.25,true,true",
    );
    expect(regimeCsv).toContain(
      "uptrend,monitoring,10,60,5,0.5,1.25,false",
    );
  });

  it("exports one JSON research bundle without changing execution state", () => {
    const json = buildPaperResearchJson(
      [outcome()],
      {
        analyticsWindowDays: 30,
        confidenceCalibrationByModel: {
          chart: calibration("chart"),
          "community-trend": calibration("community-trend"),
        },
        regimePerformance: [regime()],
        dataQualityPerformance: calculateDataQualityPerformance([outcome()]),
        sourceQualityImpact: calculateSourceQualityImpact([outcome()]),
        sourceReasonImpact: calculateSourceReasonImpact([outcome()]),
      },
      new Date("2026-09-08T12:00:00Z"),
    );
    const parsed = JSON.parse(json);

    expect(parsed).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-09-08T12:00:00.000Z",
      analyticsWindowDays: 30,
      executionLocked: true,
      researchOnly: true,
    });
    expect(parsed.dataQualityPerformance).toEqual(calculateDataQualityPerformance([outcome()]));
    expect(parsed.sourceQualityImpact).toEqual(calculateSourceQualityImpact([outcome()]));
    expect(parsed.sourceReasonImpact).toEqual(calculateSourceReasonImpact([outcome()]));
    expect(parsed.outcomes).toHaveLength(1);
    expect(parsed.outcomes[0].decisionReasons).toHaveLength(2);
    expect(parsed.regimePerformance[0].regime).toBe("uptrend");
  });

  it("preserves unknown legacy data and collecting sample counts in quality CSV", () => {
    const samples = [outcome(), outcome({ entryDataQuality: undefined })];
    const csv = buildPaperDataQualityCsv(calculateDataQualityPerformance(samples));
    expect(csv).toContain("partial,collecting,10,1,100,3,6,true,true");
    expect(csv).toContain("unknown,collecting,10,1,100,3,6,true,true");
    const sourceCsv = buildPaperSourceImpactCsv(calculateSourceQualityImpact(samples));
    expect(sourceCsv).toContain("geckoterminal,collecting,10,,0,1,");
  });

  it("preserves reason attribution and neutralizes formula-like reasons", () => {
    const csv = buildPaperSourceImpactCsv([{
      source: "geckoterminal", status: "performance-alert", minimumSamples: 5,
      reason: "=SUM(1,2)", cleanCount: 5, impairedCount: 6,
      cleanAverageNetReturnPercent: 2, impairedAverageNetReturnPercent: -1,
      returnGapPercentagePoints: -3, impairedNetPnlUsd: -6,
    }]);
    expect(csv).toContain('"\'=SUM(1,2)"');
    expect(csv).toContain(",5,6,2,-1,-3,-6,true,true");
  });

  it("accepts only supported dataset and format combinations", () => {
    expect(parsePaperExportRequest("https://example.test/api/paper/export")).toEqual({
      dataset: "outcomes",
      format: "csv",
    });
    expect(
      parsePaperExportRequest("https://example.test/api/paper/export?format=json"),
    ).toEqual({ dataset: "research", format: "json" });
    expect(
      parsePaperExportRequest(
        "https://example.test/api/paper/export?dataset=regimes&format=csv",
      ),
    ).toEqual({ dataset: "regimes", format: "csv" });
    expect(
      parsePaperExportRequest(
        "https://example.test/api/paper/export?dataset=regimes&format=json",
      ),
    ).toBeNull();
  });

  it("creates deterministic dated filenames", () => {
    const now = new Date("2026-09-08T23:59:59Z");
    expect(paperOutcomeExportFilename(now)).toBe(
      "sumi-paper-outcomes-2026-09-08.csv",
    );
    expect(
      paperResearchExportFilename(
        { dataset: "research", format: "json" },
        now,
      ),
    ).toBe("sumi-paper-research-2026-09-08.json");
  });
});
