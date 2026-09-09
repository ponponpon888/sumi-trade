import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version;
const valid = {
  buildVersion: version, mode: "paper", executionLocked: true,
  configurationStatus: "pass", safetyStatus: "monitoring",
  paperEngineStatus: "live", dataSourceQualityStatus: "healthy", dataSourceIncidentStatus: "monitoring",
};
const preload = `
const fixture = JSON.parse(process.env.SUMI_HEALTH_TEST_FIXTURE);
globalThis.fetch = async () => ({
  ok: fixture.httpStatus === 200,
  status: fixture.httpStatus,
  json: async () => fixture.body,
});
globalThis.setTimeout = (callback) => { queueMicrotask(callback); return 0; };
`;

const cases = [
  ["healthy paper engine", {}, 0],
  ["collecting quality", { dataSourceQualityStatus: "collecting" }, 0],
  ["collecting incidents", { dataSourceIncidentStatus: "collecting" }, 0],
  ["recovered incident", { dataSourceIncidentStatus: "recovered" }, 0],
  ["stale source", { dataSourceQualityStatus: "stale" }, 1],
  ["degraded source", { dataSourceQualityStatus: "degraded" }, 1],
  ["open source incident", { dataSourceIncidentStatus: "incident" }, 1],
  ["missing quality status", { dataSourceQualityStatus: undefined }, 1],
  ["invalid quality status", { dataSourceQualityStatus: "secret-value" }, 1],
  ["missing incident status", { dataSourceIncidentStatus: undefined }, 1],
  ["invalid incident status", { dataSourceIncidentStatus: "secret-value" }, 1],
  ["filters source details", { dataSourceQualityStatus: "stale", staleDataSources: ["ethereum-rpc", "secret-value", "ethereum-rpc"] }, 1],
  ["intentional safety stop", { safetyStatus: "stopped" }, 0],
  ["blocked configuration with empty details", { configurationStatus: "blocked", runtimeConfiguration: { missingOrInvalid: [] } }, 1, 200, []],
  ["reports only known configuration keys", { configurationStatus: "blocked", runtimeConfiguration: { missingOrInvalid: ["WALLET_ADDRESS", "SAFETY_CONTROL_SECRET", "UNTRUSTED_VALUE", "WALLET_ADDRESS"] } }, 1, 200, ["WALLET_ADDRESS", "SAFETY_CONTROL_SECRET"]],
  ["missing configuration", { configurationStatus: undefined }, 1],
  ["missing safety state", { safetyStatus: undefined }, 1],
  ["unknown safety state", { safetyStatus: "unknown" }, 1],
  ["unavailable safety storage", { safetyStatus: "unavailable" }, 1],
  ["execution unlocked", { executionLocked: false }, 1],
  ["live trading mode", { mode: "live" }, 1],
  ["stale paper engine", { paperEngineStatus: "stale" }, 1],
  ["wrong deployed version", { buildVersion: "0.0.0" }, 1],
  ["unavailable endpoint", {}, 1, 503],
  ["null response", null, 1],
];
for (const [name, patch, expected, httpStatus = 200, expectedConfigurationIssues = []] of cases) {
  test(name, () => {
    const reportDirectory = mkdtempSync(join(tmpdir(), "sumi-health-"));
    const reportPath = join(reportDirectory, "report.json");
    const result = spawnSync(process.execPath, [
      "--import", "data:text/javascript," + encodeURIComponent(preload),
      new URL("./check-production-health.mjs", import.meta.url).pathname,
    ], {
      encoding: "utf8", timeout: 5000,
      env: {
        ...process.env,
        SUMI_HEALTH_REPORT_PATH: reportPath,
        SUMI_HEALTH_TEST_FIXTURE: JSON.stringify({
          body: patch === null ? null : { ...valid, ...patch }, httpStatus,
        }),
      },
    });
    try {
      assert.ifError(result.error);
      assert.equal(result.status, expected, result.stdout + result.stderr);
      assert.match(result.stdout + result.stderr,
        expected === 0 ? /Production health passed/ : /blocked|Error/);
      const report = JSON.parse(readFileSync(reportPath, "utf8"));
      assert.equal(report.schemaVersion, 1);
      assert.equal(report.expectedVersion, version);
      assert.equal(report.status === "pass", expected === 0);
      assert.equal("runtimeConfiguration" in report.snapshot, false);
      assert.equal("missingOrInvalid" in report, false);
      assert.deepEqual(report.configurationIssues, expectedConfigurationIssues);
      assert.ok(!JSON.stringify(report).includes("secret-value"));
      assert.ok(!(result.stdout + result.stderr).includes("secret-value"));
      if (report.status !== "unavailable") {
        assert.deepEqual(report.warnings, patch?.dataSourceQualityStatus === "collecting" || patch?.dataSourceIncidentStatus === "collecting" ? ["DATA_SOURCE_COLLECTING"] : []);
        if (patch?.dataSourceQualityStatus === "stale") assert.ok(report.failures.includes("DATA_SOURCE_STALE"));
        if (patch?.dataSourceQualityStatus === "degraded") assert.ok(report.failures.includes("DATA_SOURCE_DEGRADED"));
        if (patch?.dataSourceIncidentStatus === "incident") assert.ok(report.failures.includes("DATA_SOURCE_INCIDENT"));
        if (patch?.staleDataSources) assert.deepEqual(report.snapshot.staleDataSources, ["ethereum-rpc"]);
      }
    } finally {
      rmSync(reportDirectory, { recursive: true, force: true });
    }
  });
}
