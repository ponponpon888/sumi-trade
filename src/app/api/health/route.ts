import { getPaperEngineHealth } from "@/lib/paper-engine-health";
import {
  getPaperJournalSnapshot,
  isPaperJournalConfigured,
} from "@/lib/paper-journal";
import { getSafetyControlSnapshot } from "@/lib/safety-control";
import { auditRuntimeConfiguration } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const walletAddress = process.env.WALLET_ADDRESS?.trim();
  const [safety, journal] = await Promise.all([
    getSafetyControlSnapshot(),
    walletAddress ? getPaperJournalSnapshot(walletAddress) : Promise.resolve(null),
  ]);
  const nowMs = Date.now();
  const runtimeConfiguration = auditRuntimeConfiguration();
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
      buildVersion: "1.20.0",
      mode: "paper",
      executionLocked: true,
      configurationStatus: runtimeConfiguration.status,
      runtimeConfiguration,
      paperJournalConfigured: isPaperJournalConfigured(),
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
