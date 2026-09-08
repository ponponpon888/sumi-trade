import type { PaperJournalStatus } from "@/lib/types";

export const PAPER_SCAN_STALE_AFTER_MINUTES = 12;

export type PaperEngineHealth =
  | "checking"
  | "live"
  | "waiting"
  | "stale"
  | "error";

export function getPaperEngineHealth({
  journalStatus,
  lastScanAt,
  nowMs,
  cadenceMinutes,
}: {
  journalStatus: PaperJournalStatus;
  lastScanAt: string | null;
  nowMs: number;
  cadenceMinutes: number;
}): PaperEngineHealth {
  if (journalStatus === "disabled" || journalStatus === "error") return "error";
  if (nowMs <= 0) return "checking";
  if (!lastScanAt) return "waiting";

  const lastScanMs = Date.parse(lastScanAt);
  if (!Number.isFinite(lastScanMs)) return "error";

  const staleAfterMinutes = Math.max(
    PAPER_SCAN_STALE_AFTER_MINUTES,
    cadenceMinutes * 2 + 2,
  );
  return nowMs - lastScanMs <= staleAfterMinutes * 60_000 ? "live" : "stale";
}
