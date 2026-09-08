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
  const report = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    healthUrl: HEALTH_URL,
    expectedVersion,
    status: failures.length === 0 ? "pass" : "blocked",
    failures,
    configurationIssues: configurationIssues(health),
    snapshot,
  };
  await saveReport(report);

  if (failures.length > 0) {
    console.error("Production health blocked", { ...snapshot, failures });
    process.exitCode = 1;
    return;
  }

  console.log("Production health passed", snapshot);
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
    configurationIssues: [],
    error: message,
    snapshot: safeSnapshot(null),
  });
  console.error("Production health Error", message);
  process.exitCode = 1;
}
