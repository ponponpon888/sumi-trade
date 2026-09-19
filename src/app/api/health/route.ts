import { BUILD_VERSION } from "@/lib/build-version";
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
  const sourceIncidents = journal?.dataSourceIncidents24h ?? [];
  const openDataSourceIncidents = sourceIncidents
    .filter((incident) => incident.status === "incident")
    .map((incident) => incident.source);
  const dataSourceIncidentStatus = openDataSourceIncidents.length > 0
    ? "incident"
    : sourceIncidents.some((incident) => incident.status === "recovered")
      ? "recovered"
      : sourceIncidents.length && sourceIncidents.every(
          (incident) => incident.status === "monitoring",
        )
        ? "monitoring"
        : "collecting";

  const sourceHistory = journal?.dataSourceQualityHistory24h ?? [];
  const staleDataSources = sourceHistory.filter((item) => item.status === "stale").map((item) => item.source);
  const degradedDataSources = sourceHistory.filter((item) => item.status === "degraded").map((item) => item.source);
  const collectingDataSources = sourceHistory.filter((item) => item.status === "collecting").map((item) => item.source);
  const dataSourceQualityStatus = staleDataSources.length > 0
    ? "stale"
    : degradedDataSources.length > 0
      ? "degraded"
      : sourceHistory.length === 0 || collectingDataSources.length > 0
        ? "collecting"
        : "healthy";

  /**
   * 取得元ごとの内訳。どのソースがどう失敗しているかを秘密情報なしで外から読めるようにする。
   * failureBreakdownは実際にリクエストを投げて失敗した回数だけを数えるため、
   * 可用率が低いのに内訳が全てゼロなら、失敗ではなく検査対象が無かったことを意味する。
   */
  const dataSourceQuality24h = sourceHistory.map((item) => ({
    source: item.source,
    status: item.status,
    observationCount: item.observationCount,
    observationAgeSeconds: item.observationAgeSeconds,
    availabilityPercent: item.availabilityPercent,
    averageCoveragePercent: item.averageCoveragePercent,
    currentFailureStreak: item.currentFailureStreak,
    failureBreakdown: item.failureBreakdown,
  }));
  const dataSourceIncidents24h = sourceIncidents.map((item) => ({
    source: item.source,
    status: item.status,
    incidentCount24h: item.incidentCount24h,
    currentFailureStreak: item.currentFailureStreak,
    currentRecoveryStreak: item.currentRecoveryStreak,
    latestIncidentStartedAt: item.latestIncidentStartedAt,
    latestRecoveredAt: item.latestRecoveredAt,
  }));

  return Response.json(
    {
      ok: true,
      service: "sumi-trade-lab",
      buildVersion: BUILD_VERSION,
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
      dataSourceIncidentStatus,
      openDataSourceIncidents,
      dataSourceQualityStatus,
      staleDataSources,
      degradedDataSources,
      collectingDataSources,
      dataSourceQuality24h,
      dataSourceIncidents24h,
      checkedAt: new Date(nowMs).toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
