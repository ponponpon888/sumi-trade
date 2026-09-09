import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/paper/export/route";
import { emptyPaperJournal } from "@/lib/paper-journal-core";
import { getPaperJournalResearchExport } from "@/lib/paper-journal";

vi.mock("@/lib/config", () => ({ getWalletAddress: () => "test-wallet" }));
vi.mock("@/lib/paper-journal", () => ({
  getPaperJournalResearchExport: vi.fn(),
}));

describe("integrated research export route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T23:59:59.000Z"));
    vi.mocked(getPaperJournalResearchExport).mockResolvedValue({
      outcomes: [],
      journal: emptyPaperJournal("disabled", "No observations"),
    });
  });

  afterEach(() => vi.useRealTimers());

  it.each([
    ["", "text/csv", "signal_time", "outcomes"],
    ["?dataset=confidence&format=csv", "text/csv", "confidence_band", "confidence"],
    ["?dataset=regimes&format=csv", "text/csv", "market_regime", "regimes"],
    ["?dataset=data-quality&format=csv", "text/csv", "quality_band", "data-quality"],
    ["?dataset=source-impact&format=csv", "text/csv", "clean_count", "source-impact"],
    ["?dataset=source-reasons&format=csv", "text/csv", "decision_reason", "source-reasons"],
    ["?dataset=research&format=json", "application/json", '"executionLocked": true', "research"],
  ])("serves the selected dataset %s from one journal read", async (query, type, content, dataset) => {
    const response = await GET(new Request(`https://example.test/api/paper/export${query}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain(type);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toContain(`sumi-paper-${dataset}-`);
    const body = await response.text();
    expect(body).toContain(content);
    expect(response.headers.get("X-Sumi-Export-As-Of")).toBe("2026-09-09T23:59:59.000Z");
    expect(response.headers.get("X-Sumi-Window-Time-Basis")).toBe("outcome_time");
    expect(body).not.toContain("test-wallet");
    expect(getPaperJournalResearchExport).toHaveBeenCalledExactlyOnceWith("test-wallet", Date.parse("2026-09-09T23:59:59.000Z"));
  });

  it("keeps one cutoff across storage, JSON and filename when the read crosses midnight", async () => {
    vi.mocked(getPaperJournalResearchExport).mockImplementation(async () => {
      vi.setSystemTime(new Date("2026-09-10T00:00:05.000Z"));
      return { outcomes: [], journal: emptyPaperJournal("disabled", "No observations") };
    });
    const response = await GET(new Request("https://example.test/api/paper/export?format=json"));
    const body = await response.json();
    expect(body.generatedAt).toBe("2026-09-09T23:59:59.000Z");
    expect(body.analysisWindow).toEqual({
      asOf: body.generatedAt,
      windowStart: "2026-08-10T23:59:59.000Z",
      windowEnd: body.generatedAt,
      timeBasis: "outcome_time",
    });
    expect(response.headers.get("Content-Disposition")).toContain("2026-09-09.json");
    expect(getPaperJournalResearchExport).toHaveBeenCalledExactlyOnceWith("test-wallet", Date.parse(body.generatedAt));
  });

  it("rejects unsupported selections before reading storage", async () => {
    const response = await GET(new Request("https://example.test/api/paper/export?dataset=regimes&format=json"));
    expect(response.status).toBe(400);
    expect(getPaperJournalResearchExport).not.toHaveBeenCalled();
  });

  it("returns an uncached generic error when storage fails", async () => {
    vi.mocked(getPaperJournalResearchExport).mockRejectedValue(new Error("private connection details"));
    const response = await GET(new Request("https://example.test/api/paper/export"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).not.toContain("private connection details");
  });
});
