import { readFile, writeFile } from "node:fs/promises";

const HEALTH_URL = "https://sumi-trade-lab.vercel.app/api/health";
const REPORT_PATH = process.env.SUMI_HEALTH_REPORT_PATH?.trim();
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const expectedVersion = packageJson.version;
const CONFIGURATION_KEYS = new Set([
  "WALLET_ADDRESS",
  "CRON_SECRET",
  "REDIS_REST_CREDENTIALS",
  "DASHBOARD_PASSWORD",
  "SAFETY_CONTROL_SECRET",
  "ETHEREUM_RPC_URL",
  "SUMI_EMERGENCY_STOP",
]);

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readHealth() {
  const response = await fetch(HEALTH_URL, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Health endpoint returned HTTP ${response.status}`);
  return response.json();
}

async function saveReport(report) {
  if (!REPORT_PATH) return;
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

const SOURCE_IDS = new Set(["blockscout", "dexscreener", "geckoterminal", "ethereum-rpc", "kyberswap"]);
const QUALITY_STATUSES = new Set(["healthy", "collecting", "degraded", "stale"]);
const INCIDENT_STATUSES = new Set(["monitoring", "collecting", "recovered", "incident"]);
const BREAKDOWN_KEYS = ["rateLimited", "timeout", "httpError", "parseError", "other"];

function sourceIds(value) {
  return Array.isArray(value) ? [...new Set(value.filter((source) => SOURCE_IDS.has(source)))] : [];
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isoOrNull(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function failureBreakdown(value) {
  const source = typeof value === "object" && value !== null ? value : {};
  return Object.fromEntries(
    BREAKDOWN_KEYS.map((key) => [key, finiteNumber(source[key]) ?? 0]),
  );
}

/** Keeps only known source IDs and recognized statuses so untrusted values never reach the report. */
function qualityDetail(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && SOURCE_IDS.has(item.source) && QUALITY_STATUSES.has(item.status))
    .map((item) => ({
      source: item.source,
      status: item.status,
      observationCount: finiteNumber(item.observationCount),
      observationAgeSeconds: finiteNumber(item.observationAgeSeconds),
      availabilityPercent: finiteNumber(item.availabilityPercent),
      averageCoveragePercent: finiteNumber(item.averageCoveragePercent),
      currentFailureStreak: finiteNumber(item.currentFailureStreak),
      failureBreakdown: failureBreakdown(item.failureBreakdown),
    }));
}

function incidentDetail(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && SOURCE_IDS.has(item.source) && INCIDENT_STATUSES.has(item.status))
    .map((item) => ({
      source: item.source,
      status: item.status,
      incidentCount24h: finiteNumber(item.incidentCount24h),
      currentFailureStreak: finiteNumber(item.currentFailureStreak),
      currentRecoveryStreak: finiteNumber(item.currentRecoveryStreak),
      latestIncidentStartedAt: isoOrNull(item.latestIncidentStartedAt),
      latestRecoveredAt: isoOrNull(item.latestRecoveredAt),
    }));
}

/**
 * One readable line per source that is not healthy. A low availability with an
 * all-zero failure breakdown means no request-level failure was recorded, which
 * points at empty check sets rather than a broken source.
 */
function sourceDiagnostics(quality, incidents) {
  const incidentBySource = new Map(incidents.map((item) => [item.source, item]));
  return quality
    .filter((item) => item.status !== "healthy")
    .map((item) => {
      const recordedFailures = BREAKDOWN_KEYS.reduce(
        (total, key) => total + item.failureBreakdown[key],
        0,
      );
      const breakdown = recordedFailures === 0
        ? "no request-level failures recorded (empty check sets?)"
        : BREAKDOWN_KEYS.filter((key) => item.failureBreakdown[key] > 0)
          .map((key) => `${key} ${item.failureBreakdown[key]}`)
          .join(", ");
      const incident = incidentBySource.get(item.source);
      const incidentPart = incident && incident.status !== "monitoring"
        ? `, incident ${incident.status}${incident.latestIncidentStartedAt ? ` since ${incident.latestIncidentStartedAt}` : ""}`
        : "";
      return `${item.source}: ${item.status}, availability ${item.availabilityPercent ?? "unknown"}%, coverage ${item.averageCoveragePercent ?? "unknown"}%, observations ${item.observationCount ?? "unknown"}, failure streak ${item.currentFailureStreak ?? "unknown"}, ${breakdown}${incidentPart}`;
    });
}

function safeSnapshot(health) {
  return {
    buildVersion: health?.buildVersion ?? null,
    mode: health?.mode ?? null,
    executionLocked: health?.executionLocked ?? null,
    configurationStatus: health?.configurationStatus ?? null,
    safetyStatus: health?.safetyStatus ?? null,
    emergencyStop: health?.emergencyStop ?? null,
    paperEngineStatus: health?.paperEngineStatus ?? null,
    operationalReadiness: health?.operationalReadiness ?? null,
    dataSourceQualityStatus: ["healthy", "collecting", "degraded", "stale"].includes(health?.dataSourceQualityStatus) ? health.dataSourceQualityStatus : null,
    dataSourceIncidentStatus: ["monitoring", "collecting", "recovered", "incident"].includes(health?.dataSourceIncidentStatus) ? health.dataSourceIncidentStatus : null,
    staleDataSources: sourceIds(health?.staleDataSources),
    degradedDataSources: sourceIds(health?.degradedDataSources),
    collectingDataSources: sourceIds(health?.collectingDataSources),
    openDataSourceIncidents: sourceIds(health?.openDataSourceIncidents),
    dataSourceQuality24h: qualityDetail(health?.dataSourceQuality24h),
    dataSourceIncidents24h: incidentDetail(health?.dataSourceIncidents24h),
  };
}

function configurationIssues(health) {
  const issues = health?.runtimeConfiguration?.missingOrInvalid;
  if (!Array.isArray(issues)) return [];
  return [...new Set(issues.filter((issue) => CONFIGURATION_KEYS.has(issue)))];
}

async function main() {
  let health = null;
  let lastError = null;

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      health = await readHealth();
      if (health?.buildVersion === expectedVersion) break;
      lastError = new Error(
        `Production build is ${health?.buildVersion ?? "unknown"}; waiting for ${expectedVersion}`,
      );
    } catch (error) {
      lastError = error;
    }
    if (attempt < 20) await wait(15_000);
  }

  if (!health || health.buildVersion !== expectedVersion) {
    throw lastError ?? new Error("Production health could not be read");
  }

  const failures = [];
  if (health.mode !== "paper") failures.push("MODE_NOT_PAPER");
  if (health.executionLocked !== true) failures.push("EXECUTION_NOT_LOCKED");
  if (health.configurationStatus !== "pass") failures.push("CONFIGURATION_NOT_PASS");
  if (health.safetyStatus === "unavailable") failures.push("SAFETY_UNAVAILABLE");
  if (!["monitoring", "stopped", "unavailable"].includes(health.safetyStatus)) {
    failures.push("SAFETY_STATUS_INVALID");
  }
  if (health.paperEngineStatus !== "live") failures.push("PAPER_ENGINE_NOT_LIVE");

  const snapshot = safeSnapshot(health);
  const sourceListKeys = ["staleDataSources", "degradedDataSources", "collectingDataSources", "openDataSourceIncidents"];
  if (sourceListKeys.some((key) => !Array.isArray(health[key]) || health[key].some((source) => !SOURCE_IDS.has(source)))) {
    failures.push("DATA_SOURCE_LIST_INVALID");
  }
  if (health.dataSourceQualityStatus === "stale" || snapshot.staleDataSources.length > 0) failures.push("DATA_SOURCE_STALE");
  if (health.dataSourceQualityStatus === "degraded" || snapshot.degradedDataSources.length > 0) failures.push("DATA_SOURCE_DEGRADED");
  if (!["healthy", "collecting", "degraded", "stale"].includes(health.dataSourceQualityStatus)) {
    failures.push("DATA_SOURCE_QUALITY_STATUS_INVALID");
  }
  if (health.dataSourceIncidentStatus === "incident" || snapshot.openDataSourceIncidents.length > 0) failures.push("DATA_SOURCE_INCIDENT");
  if (!["monitoring", "collecting", "recovered", "incident"].includes(health.dataSourceIncidentStatus)) {
    failures.push("DATA_SOURCE_INCIDENT_STATUS_INVALID");
  }
  const warnings = [];
  if (health.dataSourceQualityStatus === "collecting" || health.dataSourceIncidentStatus === "collecting" || snapshot.collectingDataSources.length > 0) {
    warnings.push("DATA_SOURCE_COLLECTING");
  }

  const report = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    healthUrl: HEALTH_URL,
    expectedVersion,
    status: failures.length === 0 ? "pass" : "blocked",
    failures,
    warnings,
    configurationIssues: configurationIssues(health),
    sourceDiagnostics: sourceDiagnostics(
      snapshot.dataSourceQuality24h,
      snapshot.dataSourceIncidents24h,
    ),
    snapshot,
  };
  await saveReport(report);

  if (failures.length > 0) {
    console.error("Production health blocked", { ...snapshot, failures });
    for (const line of report.sourceDiagnostics) console.error(`  ${line}`);
    process.exitCode = 1;
    return;
  }

  console.log("Production health passed", { ...snapshot, warnings });
  for (const line of report.sourceDiagnostics) console.log(`  ${line}`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown production health error";
  await saveReport({
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    healthUrl: HEALTH_URL,
    expectedVersion,
    status: "unavailable",
    failures: ["HEALTH_CHECK_UNAVAILABLE"],
    warnings: [],
    configurationIssues: [],
    sourceDiagnostics: [],
    error: message,
    snapshot: safeSnapshot(null),
  });
  console.error("Production health Error", message);
  process.exitCode = 1;
}
