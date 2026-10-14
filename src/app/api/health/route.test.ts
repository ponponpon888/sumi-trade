import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { emptyPaperJournal } from "@/lib/paper-journal-core";
import { getPaperJournalSnapshot } from "@/lib/paper-journal";
import { calculateDataSourceQualityHistory } from "@/lib/data-source-quality";
import packageJson from "../../../../package.json";

vi.mock("@/lib/paper-journal", () => ({
  getPaperJournalSnapshot: vi.fn(), isPaperJournalConfigured: () => true,
}));
vi.mock("@/lib/safety-control", () => ({
  getSafetyControlSnapshot: async () => ({ emergencyStop: false, status: "ready" }),
}));
vi.mock("@/lib/runtime-config", () => ({
  auditRuntimeConfiguration: () => ({ status: "ready" }),
}));

const HEALTH_URL = "https://example.vercel.app/api/health";

function healthRequest(authorization?: string): Request {
  return new Request(
    HEALTH_URL,
    authorization ? { headers: { Authorization: authorization } } : undefined,
  );
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

describe("health source monitoring", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("WALLET_ADDRESS", "private-wallet");
    vi.mocked(getPaperJournalSnapshot).mockResolvedValue(emptyPaperJournal("disabled", "test"));
  });
  afterEach(() => vi.unstubAllEnvs());

  /**
   * 本番ヘルスチェックはhealth APIのbuildVersionとpackage.jsonのversionが
   * 一致するまで待つ。両者がずれるとチェックが永久にリトライして
   * HEALTH_CHECK_UNAVAILABLEになるため、ここで固定する。
   */
  it("reports the package version as buildVersion", async () => {
    const body = await (await GET(healthRequest())).json();
    expect(body.buildVersion).toBe(packageJson.version);
  });

  it("reports missing history and incidents as collecting", async () => {
    const journal = emptyPaperJournal("disabled", "test");
    journal.dataSourceQualityHistory24h = [];
    journal.dataSourceIncidents24h = [];
    vi.mocked(getPaperJournalSnapshot).mockResolvedValue(journal);
    const response = await GET(healthRequest());
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      dataSourceQualityStatus: "collecting", dataSourceIncidentStatus: "collecting",
      staleDataSources: [], degradedDataSources: [], collectingDataSources: [],
      dataSourceQuality24h: [], dataSourceIncidents24h: [],
      mode: "paper", executionLocked: true,
    });
  });

  it.each(["healthy", "collecting", "degraded", "stale"] as const)("summarizes %s quality with explicit source IDs", async (status) => {
    const journal = emptyPaperJournal("disabled", "test");
    const history = calculateDataSourceQualityHistory([]);
    for (const item of history) item.status = "healthy";
    history[0].status = status;
    journal.dataSourceQualityHistory24h = history;
    vi.mocked(getPaperJournalSnapshot).mockResolvedValue(journal);
    const body = await (await GET(healthRequest())).json();
    expect(body.dataSourceQualityStatus).toBe(status);
    for (const state of ["stale", "degraded", "collecting"]) {
      expect(body[`${state}DataSources`]).toEqual(status === state ? [history[0].source] : []);
    }
    expect(JSON.stringify(body)).not.toContain("private-wallet");
  });

  /**
   * 可用率が低いのにfailureBreakdownが全てゼロなら、失敗ではなく検査対象が
   * 無かったことを示す。この区別を外から読めることがこの項目の目的。
   */
  it("exposes per-source 24h detail with the failure breakdown", async () => {
    const journal = emptyPaperJournal("disabled", "test");
    const history = calculateDataSourceQualityHistory([]);
    for (const item of history) item.status = "healthy";
    history[0].status = "degraded";
    history[0].availabilityPercent = 0;
    history[0].averageCoveragePercent = 0;
    history[0].currentFailureStreak = 288;
    journal.dataSourceQualityHistory24h = history;
    vi.mocked(getPaperJournalSnapshot).mockResolvedValue(journal);
    const body = await (await GET(healthRequest())).json();
    expect(body.dataSourceQuality24h).toHaveLength(history.length);
    expect(body.dataSourceQuality24h[0]).toMatchObject({
      source: history[0].source,
      status: "degraded",
      availabilityPercent: 0,
      averageCoveragePercent: 0,
      currentFailureStreak: 288,
      failureBreakdown: { rateLimited: 0, timeout: 0, httpError: 0, parseError: 0, other: 0 },
    });
    expect(Array.isArray(body.dataSourceIncidents24h)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("private-wallet");
  });

  it("prioritizes stale over degraded and collecting without hiding affected sources", async () => {
    const journal = emptyPaperJournal("disabled", "test");
    const history = calculateDataSourceQualityHistory([]);
    history[0].status = "stale";
    history[1].status = "degraded";
    journal.dataSourceQualityHistory24h = history;
    vi.mocked(getPaperJournalSnapshot).mockResolvedValue(journal);
    expect(await (await GET(healthRequest())).json()).toMatchObject({
      dataSourceQualityStatus: "stale", staleDataSources: [history[0].source],
      degradedDataSources: [history[1].source], collectingDataSources: history.slice(2).map((item) => item.source),
    });
  });

  it("returns collecting without reading a journal when no wallet is configured", async () => {
    vi.stubEnv("WALLET_ADDRESS", "");
    expect(await (await GET(healthRequest())).json()).toMatchObject({ dataSourceQualityStatus: "collecting" });
    expect(getPaperJournalSnapshot).not.toHaveBeenCalled();
  });
});

/**
 * /api/health はproxy.tsのmatcherから外れているため、認証はルート内で分岐する。
 * 認証なしで読めるのは生存確認の3項目だけで、緊急停止の状態・ウォレット設定の有無・
 * 取得元の稼働状況は外から見えてはいけない。proxy.test.tsと同じ3通りを検査する。
 */
describe("health public surface on Vercel", () => {
  const DETAIL_KEYS = [
    "buildVersion",
    "executionLocked",
    "configurationStatus",
    "runtimeConfiguration",
    "paperJournalConfigured",
    "emergencyStop",
    "safetyStatus",
    "paperEngineStatus",
    "lastPaperScanAt",
    "paperScanCount",
    "operationalReadiness",
    "observationHours",
    "scanCoverage24hPercent",
    "dataSourceIncidentStatus",
    "openDataSourceIncidents",
    "dataSourceQualityStatus",
    "staleDataSources",
    "degradedDataSources",
    "collectingDataSources",
    "dataSourceQuality24h",
    "dataSourceIncidents24h",
    "checkedAt",
  ] as const;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("WALLET_ADDRESS", "private-wallet");
    vi.mocked(getPaperJournalSnapshot).mockResolvedValue(
      emptyPaperJournal("disabled", "test"),
    );
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("DASHBOARD_USER", "owner");
    vi.stubEnv("DASHBOARD_PASSWORD", "correct-horse");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns only ok, service and mode without credentials", async () => {
    const response = await GET(healthRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      service: "sumi-trade-lab",
      mode: "paper",
    });
  });

  it("does not read the journal or the safety flag without credentials", async () => {
    await GET(healthRequest());
    expect(getPaperJournalSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong password", basicAuth("owner", "wrong")],
    ["wrong user", basicAuth("sumi", "correct-horse")],
    ["malformed header", "Basic not-base64:::"],
    ["bearer token", "Bearer correct-horse"],
  ])("hides the operational detail with %s", async (_label, authorization) => {
    const body = await (await GET(healthRequest(authorization))).json();
    for (const key of DETAIL_KEYS) expect(body).not.toHaveProperty(key);
  });

  it("returns the full detail with exact credentials", async () => {
    const response = await GET(
      healthRequest(basicAuth("owner", "correct-horse")),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    for (const key of DETAIL_KEYS) expect(body).toHaveProperty(key);
    expect(body).toMatchObject({
      ok: true,
      service: "sumi-trade-lab",
      mode: "paper",
      executionLocked: true,
    });
    expect(getPaperJournalSnapshot).toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("private-wallet");
  });

  /** ダッシュボードと同じく、認証が設定されていなければ失敗側へ閉じる。 */
  it("closes with 503 when no dashboard password is configured", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "");
    const response = await GET(
      healthRequest(basicAuth("owner", "correct-horse")),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(getPaperJournalSnapshot).not.toHaveBeenCalled();
  });
});
