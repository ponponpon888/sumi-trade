import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version;
const valid = {
  buildVersion: version, mode: "paper", executionLocked: true,
  configurationStatus: "pass", safetyStatus: "monitoring",
  staleDataSources: [], degradedDataSources: [], collectingDataSources: [], openDataSourceIncidents: [],
  paperEngineStatus: "live", dataSourceQualityStatus: "healthy", dataSourceIncidentStatus: "monitoring",
};
const emptyCheckSets = {
  source: "kyberswap", status: "degraded", observationCount: 288,
  observationAgeSeconds: 12, availabilityPercent: 0, averageCoveragePercent: 0,
  currentFailureStreak: 288,
  failureBreakdown: { rateLimited: 0, timeout: 0, httpError: 0, parseError: 0, other: 0 },
};
const preload = `
import { writeFileSync } from "node:fs";
const fixture = JSON.parse(process.env.SUMI_HEALTH_TEST_FIXTURE);
const callLog = process.env.SUMI_HEALTH_TEST_CALLS;
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), authorization: init?.headers?.authorization ?? null });
  if (callLog) writeFileSync(callLog, JSON.stringify(calls));
  return {
    ok: fixture.httpStatus === 200,
    status: fixture.httpStatus,
    json: async () => fixture.body,
  };
};
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
  ["stale list overrides healthy summary", { staleDataSources: ["ethereum-rpc"] }, 1],
  ["degraded list overrides healthy summary", { degradedDataSources: ["dexscreener"] }, 1],
  ["open incident list overrides recovered summary", { dataSourceIncidentStatus: "recovered", openDataSourceIncidents: ["kyberswap"] }, 1],
  ["collecting list retains warning", { collectingDataSources: ["geckoterminal"] }, 0],
  ["all source problems remain visible", { staleDataSources: ["ethereum-rpc"], degradedDataSources: ["dexscreener"], openDataSourceIncidents: ["kyberswap"] }, 1],
  ["missing source list", { staleDataSources: undefined }, 1],
  ["null source list", { degradedDataSources: null }, 1],
  ["wrong source list type", { openDataSourceIncidents: "secret-value" }, 1],
  ["unknown source ID", { collectingDataSources: ["secret-value"] }, 1],
  ["reports empty check sets distinctly", { dataSourceQuality24h: [emptyCheckSets] }, 0],
  ["reports recorded failure kinds", { dataSourceQuality24h: [{ ...emptyCheckSets, failureBreakdown: { ...emptyCheckSets.failureBreakdown, rateLimited: 7 } }] }, 0],
  ["keeps incident detail alongside quality detail", {
    dataSourceQuality24h: [emptyCheckSets],
    dataSourceIncidents24h: [{ source: "kyberswap", status: "incident", incidentCount24h: 1, currentFailureStreak: 288, currentRecoveryStreak: 0, latestIncidentStartedAt: "2026-09-17T05:00:00.000Z", latestRecoveredAt: null }],
  }, 0],
  ["filters unknown detail sources", {
    dataSourceQuality24h: [{ ...emptyCheckSets, source: "secret-value" }],
    dataSourceIncidents24h: [{ source: "secret-value", status: "incident", incidentCount24h: 1, currentFailureStreak: 3, currentRecoveryStreak: 0, latestIncidentStartedAt: "secret-value", latestRecoveredAt: null }],
  }, 0],
  ["filters unknown detail statuses", { dataSourceQuality24h: [{ ...emptyCheckSets, status: "secret-value" }] }, 0],
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
      fileURLToPath(new URL("./check-production-health.mjs", import.meta.url)),
    ], {
      encoding: "utf8", timeout: 5000,
      env: {
        ...process.env,
        DASHBOARD_USER: "owner",
        DASHBOARD_PASSWORD: "correct-horse",
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
        assert.deepEqual(report.warnings, patch?.dataSourceQualityStatus === "collecting" || patch?.dataSourceIncidentStatus === "collecting" || patch?.collectingDataSources?.includes("geckoterminal") ? ["DATA_SOURCE_COLLECTING"] : []);
        if (patch?.dataSourceQualityStatus === "stale" || patch?.staleDataSources?.includes("ethereum-rpc")) assert.ok(report.failures.includes("DATA_SOURCE_STALE"));
        if (patch?.dataSourceQualityStatus === "degraded" || patch?.degradedDataSources?.includes("dexscreener")) assert.ok(report.failures.includes("DATA_SOURCE_DEGRADED"));
        if (patch?.dataSourceIncidentStatus === "incident" || patch?.openDataSourceIncidents?.includes("kyberswap")) assert.ok(report.failures.includes("DATA_SOURCE_INCIDENT"));
        const merged = { ...valid, ...patch };
        if (["staleDataSources", "degradedDataSources", "collectingDataSources", "openDataSourceIncidents"].some((key) => !Array.isArray(merged[key]) || merged[key].includes("secret-value"))) {
          assert.ok(report.failures.includes("DATA_SOURCE_LIST_INVALID"));
        }
        if (patch?.staleDataSources) assert.deepEqual(report.snapshot.staleDataSources, ["ethereum-rpc"]);
        // 取得元の内訳は失敗判定を変えず、診断だけを増やす
        assert.ok(Array.isArray(report.snapshot.dataSourceQuality24h));
        assert.ok(Array.isArray(report.snapshot.dataSourceIncidents24h));
        if (name === "reports empty check sets distinctly") {
          assert.equal(report.snapshot.dataSourceQuality24h.length, 1);
          assert.ok(report.sourceDiagnostics.some((line) =>
            line.startsWith("kyberswap: degraded") && line.includes("no request-level failures recorded")));
        }
        if (name === "reports recorded failure kinds") {
          assert.ok(report.sourceDiagnostics.some((line) => line.includes("rateLimited 7")));
          assert.ok(!report.sourceDiagnostics.some((line) => line.includes("no request-level failures recorded")));
        }
        if (name === "keeps incident detail alongside quality detail") {
          assert.equal(report.snapshot.dataSourceIncidents24h.length, 1);
          assert.ok(report.sourceDiagnostics.some((line) =>
            line.includes("incident incident since 2026-09-17T05:00:00.000Z")));
        }
        if (name.startsWith("filters unknown detail")) {
          assert.deepEqual(report.snapshot.dataSourceQuality24h, []);
          assert.deepEqual(report.snapshot.dataSourceIncidents24h, []);
          assert.deepEqual(report.sourceDiagnostics, []);
        }
      }
    } finally {
      rmSync(reportDirectory, { recursive: true, force: true });
    }
  });
}

/**
 * PR #3 で /api/health の詳細が認証ありに移った。認証なしの応答は ok・service・mode の
 * 3項目だけなので、buildVersion の一致を待つリトライでは永久に埋まらない。認証あり・
 * なし・未設定の3通りを、送ったヘッダーとリクエスト回数まで含めて検査する。
 */
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
const authenticatedBody = { ok: true, service: "sumi-trade-lab", ...valid };
const livenessOnlyBody = { ok: true, service: "sumi-trade-lab", mode: "paper" };

function runMonitor({ body, httpStatus = 200, credentials }) {
  const reportDirectory = mkdtempSync(join(tmpdir(), "sumi-health-auth-"));
  const reportPath = join(reportDirectory, "report.json");
  const callPath = join(reportDirectory, "calls.json");
  const env = {
    ...process.env,
    SUMI_HEALTH_REPORT_PATH: reportPath,
    SUMI_HEALTH_TEST_CALLS: callPath,
    SUMI_HEALTH_TEST_FIXTURE: JSON.stringify({ body, httpStatus }),
  };
  delete env.DASHBOARD_USER;
  delete env.DASHBOARD_PASSWORD;
  Object.assign(env, credentials ?? {});
  const result = spawnSync(process.execPath, [
    "--import", "data:text/javascript," + encodeURIComponent(preload),
    fileURLToPath(new URL("./check-production-health.mjs", import.meta.url)),
  ], { encoding: "utf8", timeout: 5000, env });
  try {
    assert.ifError(result.error);
    return {
      result,
      report: JSON.parse(readFileSync(reportPath, "utf8")),
      calls: existsSync(callPath) ? JSON.parse(readFileSync(callPath, "utf8")) : [],
      output: result.stdout + result.stderr,
    };
  } finally {
    rmSync(reportDirectory, { recursive: true, force: true });
  }
}

test("authenticated: sends Basic credentials and audits the detail", () => {
  const { result, report, calls, output } = runMonitor({
    body: authenticatedBody,
    credentials: { DASHBOARD_USER: "owner", DASHBOARD_PASSWORD: "correct-horse" },
  });
  assert.equal(result.status, 0, output);
  assert.equal(report.status, "pass");
  assert.deepEqual(report.failures, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].authorization, basic("owner", "correct-horse"));
  // パスワードを報告や出力へ写さない
  assert.ok(!JSON.stringify(report).includes("correct-horse"));
  assert.ok(!output.includes("correct-horse"));
});

test("authenticated: defaults the user name to sumi", () => {
  const { result, calls, output } = runMonitor({
    body: authenticatedBody,
    credentials: { DASHBOARD_PASSWORD: "correct-horse" },
  });
  assert.equal(result.status, 0, output);
  assert.equal(calls[0].authorization, basic("sumi", "correct-horse"));
});

test("unauthenticated: stops on the liveness-only response without retrying", () => {
  const { result, report, calls, output } = runMonitor({
    body: livenessOnlyBody,
    credentials: { DASHBOARD_PASSWORD: "wrong-horse" },
  });
  assert.equal(result.status, 1, output);
  assert.deepEqual(report.failures, ["HEALTH_CHECK_UNAUTHENTICATED"]);
  assert.equal(report.status, "unavailable");
  assert.equal(calls.length, 1, "20回のリトライはしない");
  assert.match(output, /HEALTH_CHECK_UNAUTHENTICATED/);
});

test("unauthenticated: stops on HTTP 401 without retrying", () => {
  const { result, report, calls, output } = runMonitor({
    body: { ok: false, error: "Authentication required." },
    httpStatus: 401,
    credentials: { DASHBOARD_PASSWORD: "wrong-horse" },
  });
  assert.equal(result.status, 1, output);
  assert.deepEqual(report.failures, ["HEALTH_CHECK_UNAUTHENTICATED"]);
  assert.equal(calls.length, 1, "20回のリトライはしない");
});

test("missing credentials: dedicated failure, no request, not HEALTH_CHECK_UNAVAILABLE", () => {
  const { result, report, calls, output } = runMonitor({
    body: authenticatedBody,
    credentials: null,
  });
  assert.equal(result.status, 1, output);
  assert.deepEqual(report.failures, ["HEALTH_CHECK_CREDENTIALS_MISSING"]);
  assert.ok(!report.failures.includes("HEALTH_CHECK_UNAVAILABLE"));
  assert.equal(report.status, "unavailable");
  assert.equal(calls.length, 0, "リクエストを投げない");
  assert.match(output, /DASHBOARD_PASSWORD is not set/);
});
