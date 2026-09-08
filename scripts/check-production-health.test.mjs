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
  paperEngineStatus: "live",
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
  ["intentional safety stop", { safetyStatus: "stopped" }, 0],
  ["blocked configuration with empty details", { configurationStatus: "blocked", runtimeConfiguration: { missingOrInvalid: [] } }, 1],
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
for (const [name, patch, expected, httpStatus = 200] of cases) {
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
    } finally {
      rmSync(reportDirectory, { recursive: true, force: true });
    }
  });
}
