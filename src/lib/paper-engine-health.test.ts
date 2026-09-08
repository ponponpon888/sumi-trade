import { describe, expect, it } from "vitest";

import {
  getPaperEngineHealth,
  PAPER_SCAN_STALE_AFTER_MINUTES,
} from "@/lib/paper-engine-health";

const NOW = Date.UTC(2026, 8, 8, 8, 35);

describe("paper engine health", () => {
  it("reports a recent persisted scan as live", () => {
    expect(
      getPaperEngineHealth({
        journalStatus: "collecting",
        lastScanAt: new Date(NOW - 5 * 60_000).toISOString(),
        nowMs: NOW,
        cadenceMinutes: 5,
      }),
    ).toBe("live");
  });

  it("reports a scan beyond the safety window as stale", () => {
    expect(
      getPaperEngineHealth({
        journalStatus: "collecting",
        lastScanAt: new Date(
          NOW - (PAPER_SCAN_STALE_AFTER_MINUTES + 1) * 60_000,
        ).toISOString(),
        nowMs: NOW,
        cadenceMinutes: 5,
      }),
    ).toBe("stale");
  });

  it("surfaces storage failures independently of scan time", () => {
    expect(
      getPaperEngineHealth({
        journalStatus: "error",
        lastScanAt: new Date(NOW).toISOString(),
        nowMs: NOW,
        cadenceMinutes: 5,
      }),
    ).toBe("error");
  });

  it("waits explicitly when no persisted scan exists yet", () => {
    expect(
      getPaperEngineHealth({
        journalStatus: "collecting",
        lastScanAt: null,
        nowMs: NOW,
        cadenceMinutes: 5,
      }),
    ).toBe("waiting");
  });
});
