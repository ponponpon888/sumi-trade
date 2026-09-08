import { describe, expect, it } from "vitest";

import { assessModelDrift } from "@/lib/model-drift";
import { emptyPaperJournal } from "@/lib/paper-journal-core";
import type {
  PaperJournalSnapshot,
  PaperPeriodPerformance,
} from "@/lib/types";

function performance(
  days: 1 | 7 | 30,
  maturedCount: number,
  averageNetReturnPercent: number,
  netPnlUsd: number,
  profitFactor: number | null,
): PaperPeriodPerformance {
  return {
    days,
    maturedCount,
    averageNetReturnPercent,
    netPnlUsd,
    profitFactor,
    winRate: 50,
    maxDrawdownPercent: 2,
  };
}

function journal(
  recent = performance(7, 12, 0.5, 20, 1.3),
  baseline = performance(30, 35, 0.7, 80, 1.5),
  overrides: Partial<PaperJournalSnapshot> = {},
): PaperJournalSnapshot {
  return {
    ...emptyPaperJournal("disabled", "test"),
    status: "collecting",
    storageConfigured: true,
    periodPerformance: [performance(1, 2, 0.2, 2, 1), recent, baseline],
    ...overrides,
  };
}

describe("model drift", () => {
  it("collects without adding a BUY block before evidence is sufficient", () => {
    const result = assessModelDrift(
      journal(performance(7, 9, -4, -30, 0.2), performance(30, 29, 1, 80, 1.5)),
    );

    expect(result.status).toBe("collecting");
    expect(result.blockNewBuys).toBe(false);
  });

  it("passes ordinary short-term variation", () => {
    const result = assessModelDrift(journal());

    expect(result.status).toBe("stable");
    expect(result.blockNewBuys).toBe(false);
  });

  it("blocks BUY when recent negative returns fall materially below baseline", () => {
    const result = assessModelDrift(
      journal(performance(7, 12, -1.1, -55, 0.9), performance(30, 35, 0.8, 90, 1.4)),
    );

    expect(result.status).toBe("degraded");
    expect(result.blockNewBuys).toBe(true);
    expect(result.averageReturnDropPercentagePoints).toBe(1.9);
  });

  it("blocks BUY when profit factor collapses from a qualified baseline", () => {
    const result = assessModelDrift(
      journal(performance(7, 12, 0.1, -10, 0.7), performance(30, 35, 0.8, 90, 1.3)),
    );

    expect(result.status).toBe("degraded");
    expect(result.reasons[0]).toContain("PF");
  });

  it("treats missing storage as unavailable and fails closed", () => {
    const result = assessModelDrift(journal(undefined, undefined, {
      storageConfigured: false,
      status: "disabled",
    }));

    expect(result.status).toBe("unavailable");
    expect(result.blockNewBuys).toBe(true);
  });
});
