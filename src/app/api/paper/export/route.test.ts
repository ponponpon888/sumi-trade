import { beforeEach, describe, expect, it, vi } from "vitest";

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
    vi.mocked(getPaperJournalResearchExport).mockResolvedValue({
      outcomes: [],
      journal: emptyPaperJournal("disabled", "No observations"),
    });
  });

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
    expect(body).not.toContain("test-wallet");
    expect(getPaperJournalResearchExport).toHaveBeenCalledExactlyOnceWith("test-wallet");
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
