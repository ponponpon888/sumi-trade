import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChartModelSnapshot,
  PortfolioSnapshot,
  StrategyPlan,
  TrendScoutSnapshot,
} from "@/lib/types";

/**
 * Storage cost of one request, fixed here so a regression lands in CI.
 *
 * The journal used to read its whole retention on every request: one index
 * range plus an mget per 250 records, which at a five-minute cadence over 31
 * days is 37 commands and 8,928 record keys. Both numbers grew with the
 * retention. The ceilings below do not: the day keys are a function of the
 * window lengths, the quality keys of the 24h cadence, and the record keys of
 * the settlement horizon alone.
 *
 * Scan read: cursor (1) + scan days (1) + trade days (1) + quality (2) +
 * index range (1) + record keys (1) = 7 commands over 8 + 32 + 288 + 97 keys.
 * Write: one pipeline of the four raw operations plus a key for the cursor,
 * each touched day and each fresh quality row. Health drops the index range
 * and the record keys, leaving 5 commands over 328 keys.
 *
 * A scan measures 15 commands and a health request 5. The command ceilings
 * leave room for the extra day key each window touches when a scan lands on a
 * UTC midnight; the key ceilings are the arithmetic maximum and so are exact.
 */
const SCAN_COMMAND_CEILING = 18;
const SCAN_MGET_KEY_CEILING = 425;
const HEALTH_COMMAND_CEILING = 6;
const HEALTH_MGET_KEY_CEILING = 328;
/** Eight hours of five-minute buckets, plus the bucket at each edge. */
const RAW_RECORD_CEILING = 97;

type Command = { name: string; keys: string[] };

const values = new Map<string, string>();
const zsets = new Map<string, Map<string, number>>();
let commands: Command[] = [];

function record(name: string, keys: string[]): void {
  commands.push({ name, keys });
}

/** Round-trips through JSON the way the REST client does. */
function read(key: string): unknown {
  const raw = values.get(key);
  return raw === undefined ? null : JSON.parse(raw);
}

class FakeRedis {
  async get(key: string): Promise<unknown> {
    record("get", [key]);
    return read(key);
  }

  async mget(...keys: string[]): Promise<unknown[]> {
    record("mget", keys);
    return keys.map(read);
  }

  async zrange(key: string, min: number, max: number): Promise<string[]> {
    record("zrange", [key]);
    return [...(zsets.get(key) ?? new Map()).entries()]
      .filter(([, score]) => score >= min && score <= max)
      .toSorted((left, right) => left[1] - right[1])
      .map(([member]) => member);
  }

  pipeline() {
    const queued: Array<() => void> = [];
    const api = {
      set(key: string, value: unknown) {
        queued.push(() => {
          record("set", [key]);
          values.set(key, JSON.stringify(value));
        });
        return api;
      },
      zadd(key: string, entry: { score: number; member: string }) {
        queued.push(() => {
          record("zadd", [key]);
          const zset = zsets.get(key) ?? new Map<string, number>();
          zset.set(entry.member, entry.score);
          zsets.set(key, zset);
        });
        return api;
      },
      zremrangebyscore(key: string, min: number, max: number) {
        queued.push(() => {
          record("zremrangebyscore", [key]);
          const zset = zsets.get(key);
          if (!zset) return;
          for (const [member, score] of [...zset.entries()]) {
            if (score >= min && score <= max) zset.delete(member);
          }
        });
        return api;
      },
      expire(key: string) {
        queued.push(() => record("expire", [key]));
        return api;
      },
      async exec() {
        for (const run of queued) run();
        return [];
      },
    };
    return api;
  }
}

vi.mock("@upstash/redis", () => ({ Redis: FakeRedis }));
vi.mock("@/lib/dexscreener", () => ({
  getTokenMarkets: async () => new Map(),
}));

const {
  getPaperJournalHealth,
  journalDayKeys,
  readPaperJournalContext,
  recordPaperScan,
} = await import("@/lib/paper-journal");

const WALLET = "0x0000000000000000000000000000000000000001";
const INDEX_KEY = `sumi:paper:v1:${WALLET}:index`;
const ONE_HOUR_MS = 60 * 60 * 1_000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const SCAN_CADENCE_MS = 5 * 60 * 1_000;
const START_MS = Date.UTC(2026, 8, 1, 0, 0, 0);
/** A full 24h of scans, so the quality window is at its widest. */
const SEED_SCANS = 24 * 12;

/**
 * Only the fields the record and the source assessment actually read.
 *
 * The rest of a plan is irrelevant here — `createPaperScanRecord` reads its
 * signals and nothing else — so it is cast rather than invented, which keeps
 * the fixture from implying the budget depends on it. A community-trend
 * rotation is the cheapest signal to state, and it is here so the scan budget
 * covers the day keys a selected signal and its outcome are written to.
 */
function dashboardData(priceUsd = 100): {
  snapshot: PortfolioSnapshot;
  chartModel: ChartModelSnapshot;
  plan: StrategyPlan;
  trendScout: TrendScoutSnapshot;
} {
  const snapshot: PortfolioSnapshot = {
    walletAddress: WALLET,
    generatedAt: new Date(START_MS).toISOString(),
    source: "blockscout+dexscreener",
    totalUsd: 1_000,
    tradeableUsd: 1_000,
    blockedUsd: 0,
    gasBalanceEth: 0.01,
    gasBalanceUsd: 25,
    gasReserveEth: 0.005,
    assets: [],
    ignoredTokenCount: 0,
    warnings: [],
    sourceChecks: { dexscreener: [{ outcome: "success" }] },
  };
  const chartModel: ChartModelSnapshot = {
    generatedAt: snapshot.generatedAt,
    source: "geckoterminal",
    cadenceMinutes: 5,
    requestedAssetCount: 0,
    readyAssetCount: 0,
    ethBenchmark: { status: "ready", sparkline: [], correlationSeries: [] },
    analyses: [],
    warnings: [],
    sourceChecks: { geckoterminal: [{ outcome: "success" }] },
  };
  const trendScout: TrendScoutSnapshot = {
    generatedAt: snapshot.generatedAt,
    source: "geckoterminal",
    mode: "shadow",
    executionLocked: true,
    candidateCount: 1,
    paperCandidateCount: 1,
    candidates: [],
    paperRotation: {
      fromSymbol: "WETH",
      fromContractAddress: "0x00000000000000000000000000000000000000ff",
      toSymbol: "TREND",
      toContractAddress: "0x00000000000000000000000000000000000000ee",
      entryPriceUsd: priceUsd,
      amountUsd: 200,
      allocationPercent: 20,
      estimatedRoundTripCostUsd: 2,
      estimatedPriceImpactPercent: 0.1,
      estimatedOneWaySlippagePercent: 0.2,
      costGatePassed: true,
      score: 70,
      executionLocked: true,
    },
    warnings: [],
  };
  return {
    snapshot,
    chartModel,
    plan: { signals: [] } as unknown as StrategyPlan,
    trendScout,
  };
}

function commandCount(): number {
  return commands.length;
}

function mgetKeyCount(): number {
  return commands
    .filter((command) => command.name === "mget")
    .reduce((total, command) => total + command.keys.length, 0);
}

function touchedKeys(): string[] {
  return commands.flatMap((command) => command.keys);
}

/**
 * The drift, period and timeline windows all cut on the time an outcome was
 * scored, and the store is partitioned by the UTC date of that time. A range
 * read therefore has to ask for the date its window starts in, not only the
 * whole days after it, or every outcome scored in the first part of that day
 * is silently missing from the oldest baseline.
 */
describe("journal day keys", () => {
  it("includes the date each window edge falls in", () => {
    const toMs = Date.UTC(2026, 8, 30, 12);
    const dates = journalDayKeys(toMs - 30 * ONE_DAY_MS, toMs);

    expect(dates).toHaveLength(31);
    expect(dates[0]).toBe("2026-08-31");
    expect(dates.at(-1)).toBe("2026-09-30");
  });

  it("reaches the day the twelve-hour confirmation anchor moves into", () => {
    const toMs = Date.UTC(2026, 8, 30, 6);
    const confirmationBaselineMs = toMs - 12 * ONE_HOUR_MS - 30 * ONE_DAY_MS;

    expect(journalDayKeys(confirmationBaselineMs, toMs)[0]).toBe("2026-08-30");
    expect(journalDayKeys(toMs - 30 * ONE_DAY_MS, toMs)[0]).toBe("2026-08-31");
  });

  it("returns the one date a range inside a single day touches", () => {
    const fromMs = Date.UTC(2026, 8, 30, 1);
    expect(journalDayKeys(fromMs, fromMs + ONE_HOUR_MS)).toEqual([
      "2026-09-30",
    ]);
  });
});

describe("paper journal storage budget", () => {
  beforeEach(async () => {
    values.clear();
    zsets.clear();
    commands = [];
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");

    for (let index = 0; index < SEED_SCANS; index += 1) {
      await recordPaperScan(
        dashboardData(100 + (index % 9)),
        START_MS + index * SCAN_CADENCE_MS,
      );
    }
    commands = [];
  });

  afterEach(() => vi.unstubAllEnvs());

  it("keeps the raw records to the settlement window", () => {
    expect(zsets.get(INDEX_KEY)?.size ?? 0).toBeLessThanOrEqual(
      RAW_RECORD_CEILING,
    );
    expect(zsets.get(INDEX_KEY)?.size ?? 0).toBeGreaterThan(0);
  });

  it("holds one scan to a fixed command and key budget", async () => {
    const nowMs = START_MS + SEED_SCANS * SCAN_CADENCE_MS;
    const context = await readPaperJournalContext(WALLET, nowMs);
    await recordPaperScan(dashboardData(), nowMs, context.store);

    expect(commandCount()).toBeLessThanOrEqual(SCAN_COMMAND_CEILING);
    expect(mgetKeyCount()).toBeLessThanOrEqual(SCAN_MGET_KEY_CEILING);
  });

  it("holds one health request to a fixed command and key budget", async () => {
    const nowMs = START_MS + SEED_SCANS * SCAN_CADENCE_MS;
    const journal = await getPaperJournalHealth(WALLET, nowMs);

    expect(commandCount()).toBeLessThanOrEqual(HEALTH_COMMAND_CEILING);
    expect(mgetKeyCount()).toBeLessThanOrEqual(HEALTH_MGET_KEY_CEILING);
    expect(journal.status).not.toBe("error");
  });

  /**
   * The health endpoint's own version of the same ceiling: not a smaller read
   * of the raw records, but no read of them at all.
   */
  it("reads no raw record on the health path", async () => {
    const nowMs = START_MS + SEED_SCANS * SCAN_CADENCE_MS;
    await getPaperJournalHealth(WALLET, nowMs);

    expect(commands.some((command) => command.name === "zrange")).toBe(false);
    expect(touchedKeys().some((key) => key.includes(":record:"))).toBe(false);
  });

  /**
   * The read has to span the boundary day at both ends of the record window,
   * because an outcome scored in the first hours of the oldest day is still
   * inside the thirty-day analytics.
   */
  it("asks for the outcome day keys the record window starts in", async () => {
    const nowMs = START_MS + SEED_SCANS * SCAN_CADENCE_MS;
    await getPaperJournalHealth(WALLET, nowMs);

    const tradeKeys = commands
      .flatMap((command) => command.keys)
      .filter((key) => key.includes(":d1:trade:"))
      .map((key) => key.split(":d1:trade:")[1]);
    const expected = journalDayKeys(nowMs - 31 * ONE_DAY_MS, nowMs);

    expect(tradeKeys).toEqual(expected);
    expect(tradeKeys).toHaveLength(32);
    expect(tradeKeys[0]).toBe(
      new Date(nowMs - 31 * ONE_DAY_MS).toISOString().slice(0, 10),
    );
  });

  it("still reports the 24h coverage the readiness gate reads", async () => {
    const nowMs = START_MS + SEED_SCANS * SCAN_CADENCE_MS;
    const journal = await getPaperJournalHealth(WALLET, nowMs);

    expect(journal.scanCount).toBe(SEED_SCANS);
    expect(
      journal.operationalReadiness.scanCoverage24hPercent,
    ).toBeGreaterThanOrEqual(99);
    expect(journal.dataSourceQualityHistory24h).not.toHaveLength(0);
  });
});
