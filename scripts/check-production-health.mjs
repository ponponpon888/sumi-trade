import { readFile } from "node:fs/promises";

const HEALTH_URL = "https://sumi-trade-lab.vercel.app/api/health";
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const expectedVersion = packageJson.version;

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

let health = null;
let lastError = null;

for (let attempt = 1; attempt <= 20; attempt += 1) {
  try {
    health = await readHealth();
    if (health.buildVersion === expectedVersion) break;
    lastError = new Error(
      `Production build is ${health.buildVersion ?? "unknown"}; waiting for ${expectedVersion}`,
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
if (health.configurationStatus !== "pass") {
  failures.push(...(health.runtimeConfiguration?.missingOrInvalid ?? ["CONFIGURATION"]));
}
if (health.safetyStatus === "unavailable") failures.push("SAFETY_UNAVAILABLE");
if (health.paperEngineStatus !== "live") failures.push("PAPER_ENGINE_NOT_LIVE");

const summary = {
  buildVersion: health.buildVersion,
  mode: health.mode,
  executionLocked: health.executionLocked,
  configurationStatus: health.configurationStatus,
  safetyStatus: health.safetyStatus,
  paperEngineStatus: health.paperEngineStatus,
  operationalReadiness: health.operationalReadiness,
  missingOrInvalid: health.runtimeConfiguration?.missingOrInvalid ?? [],
};

if (failures.length > 0) {
  console.error("Production health blocked", { ...summary, failures });
  process.exit(1);
}

console.log("Production health passed", summary);
