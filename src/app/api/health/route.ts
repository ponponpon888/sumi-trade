import { getPaperEngineHealth } from "@/lib/paper-engine-health";
import {
  getPaperJournalSnapshot,
  isPaperJournalConfigured,
} from "@/lib/paper-journal";
import { getSafetyControlSnapshot } from "@/lib/safety-control";

export const dynamic = "force-dynamic";

export async function GET() {
  const walletAddress = process.env.WALLET_ADDRESS?.trim();
  const [safety, journal] = await Promise.all([
    getSafetyControlSnapshot(),
    walletAddress ? getPaperJournalSnapshot(walletAddress) : Promise.resolve(null),
  ]);
  const nowMs = Date.now();
  const paperEngineStatus = journal
    ? getPaperEngineHealth({
        journalStatus: journal.status,
        lastScanAt: journal.lastScanAt,
        nowMs,
        cadenceMinutes: 5,
      })
    : "error";

  return Response.json(
    {
      ok: true,
      service: "sumi-trade-lab",
      mode: "paper",
      executionLocked: true,
      paperJournalConfigured: isPaperJournalConfigured(),
      dashboardAuthConfigured: Boolean(process.env.DASHBOARD_PASSWORD?.trim()),
      safetyControlConfigured: Boolean(process.env.SAFETY_CONTROL_SECRET?.trim()),
      emergencyStop: safety.emergencyStop,
      safetyStatus: safety.status,
      paperEngineStatus,
      lastPaperScanAt: journal?.lastScanAt ?? null,
      paperScanCount: journal?.scanCount ?? 0,
      operationalReadiness: journal?.operationalReadiness.status ?? "blocked",
      observationHours: journal?.operationalReadiness.observationHours ?? 0,
      scanCoverage24hPercent:
        journal?.operationalReadiness.scanCoverage24hPercent ?? 0,
      checkedAt: new Date(nowMs).toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
