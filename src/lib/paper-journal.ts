import "server-only";

import { Redis } from "@upstash/redis";

import { getTokenMarkets } from "@/lib/dexscreener";
import {
  createPaperScanRecord,
  emptyPaperJournal,
  evaluateJournalInput,
  JOURNAL_ANALYTICS_WINDOW_DAYS,
  JOURNAL_RAW_WINDOW_HOURS,
  JOURNAL_RECORD_WINDOW_DAYS,
  JOURNAL_WINDOW_DAYS,
  OUTCOME_HORIZON_HOURS,
  type JournalInput,
  type JournalQualityRow,
  type JournalScanRow,
  type JournalStoredCandidate,
  type JournalStoredOutcome,
} from "@/lib/paper-journal-core";
import {
  advanceJournal,
  isJournalCursor,
  journalInputFromStore,
  type JournalAdvance,
  type JournalCursor,
} from "@/lib/paper-journal-derived";
import type {
  ChartModelSnapshot,
  PaperJournalSnapshot,
  PaperScanRecord,
  PaperTradeOutcome,
  PortfolioSnapshot,
  StrategyPlan,
  TrendScoutSnapshot,
} from "@/lib/types";

const ONE_HOUR_MS = 60 * 60 * 1_000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const READ_BATCH_SIZE = 250;

/**
 * How the journal is laid out in storage.
 *
 * Raw records only have to outlive the settlement horizon, because nothing
 * past it reads a price. Everything the seven-day and thirty-day windows
 * report is accumulated into day keys as it is decided, so the cost of a read
 * stopped growing with the retention period.
 */
const RAW_WINDOW_MS = JOURNAL_RAW_WINDOW_HOURS * ONE_HOUR_MS;
/** Two hours past the window, so the index drops a record before its value expires. */
const RAW_TTL_SECONDS = (JOURNAL_RAW_WINDOW_HOURS + 2) * 60 * 60;
/** Two days past the record window, so a day key outlives every range that reads it. */
const DERIVED_TTL_SECONDS = (JOURNAL_RECORD_WINDOW_DAYS + 2) * 24 * 60 * 60;
const QUALITY_WINDOW_MS = 24 * ONE_HOUR_MS;
const QUALITY_TTL_SECONDS = 26 * 60 * 60;

const TREND_PRICE_TRACKING_MS =
  (OUTCOME_HORIZON_HOURS * 60 + 90) * 60 * 1_000;
const MAX_TRACKED_TREND_TOKENS = 20;

type DashboardData = {
  snapshot: PortfolioSnapshot;
  chartModel: ChartModelSnapshot;
  plan: StrategyPlan;
  trendScout?: TrendScoutSnapshot;
};

type TradeDay = {
  candidates: JournalStoredCandidate[];
  outcomes: JournalStoredOutcome[];
};

function redisConfiguration(): { url: string; token: string } | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim();
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

export function isPaperJournalConfigured(): boolean {
  return redisConfiguration() !== null;
}

function getRedis(): Redis | null {
  const configuration = redisConfiguration();
  if (!configuration) return null;
  return new Redis({ ...configuration, enableTelemetry: false });
}

function namespace(walletAddress: string): string {
  return `sumi:paper:v1:${walletAddress.toLowerCase()}`;
}

function bucketId(bucketTimeMs: number): string {
  return new Date(bucketTimeMs).toISOString().replace(/[:.]/g, "-");
}

function utcDate(timeMs: number): string {
  return new Date(timeMs).toISOString().slice(0, 10);
}

/**
 * Every UTC date an inclusive time range touches, oldest first.
 *
 * The derived store is partitioned by the UTC date of each row, and a window
 * both starts and ends in the middle of a day. Asking only for the whole days
 * inside the window would drop the part of each boundary day that is still in
 * range, so both endpoints' own dates are read and the exact millisecond
 * filtering is left to the evaluation.
 */
export function journalDayKeys(fromMs: number, toMs: number): string[] {
  const dates: string[] = [];
  const firstDayMs = Math.floor(fromMs / ONE_DAY_MS) * ONE_DAY_MS;
  for (let dayMs = firstDayMs; dayMs <= toMs; dayMs += ONE_DAY_MS) {
    dates.push(utcDate(dayMs));
  }
  return dates;
}

/**
 * The day keys and the quality window one request may read or write.
 *
 * Read and write share it so a scan never files a row into a key that no later
 * read would ask for. Seeding the store from the whole retention would
 * otherwise write a day key per retained day and a quality key per retained
 * bucket, none of which any window reports from.
 */
type JournalRetention = {
  scanDates: Set<string>;
  tradeDates: Set<string>;
  qualityFromMs: number;
};

function retentionFor(nowMs: number): JournalRetention {
  return {
    scanDates: new Set(
      journalDayKeys(nowMs - JOURNAL_WINDOW_DAYS * ONE_DAY_MS, nowMs),
    ),
    tradeDates: new Set(
      journalDayKeys(nowMs - JOURNAL_RECORD_WINDOW_DAYS * ONE_DAY_MS, nowMs),
    ),
    qualityFromMs: nowMs - QUALITY_WINDOW_MS,
  };
}

function isPaperScanRecord(value: unknown): value is PaperScanRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PaperScanRecord>;
  return (
    record.schemaVersion === 1 &&
    record.executionLocked === true &&
    typeof record.id === "string" &&
    typeof record.bucketTimeMs === "number" &&
    typeof record.generatedAt === "string" &&
    typeof record.walletAddress === "string" &&
    typeof record.prices === "object" &&
    Array.isArray(record.signals)
  );
}

function isScanRow(value: unknown): value is JournalScanRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<JournalScanRow>;
  return (
    typeof row.bucketTimeMs === "number" &&
    typeof row.generatedAt === "string" &&
    typeof row.portfolioValueUsd === "number"
  );
}

function isQualityRow(value: unknown): value is JournalQualityRow {
  if (!value || typeof value !== "object") return false;
  return typeof (value as Partial<JournalQualityRow>).bucketTimeMs === "number";
}

function scanRowsOf(value: unknown): JournalScanRow[] {
  return Array.isArray(value) ? value.filter(isScanRow) : [];
}

function tradeDayOf(value: unknown): TradeDay {
  if (!value || typeof value !== "object") {
    return { candidates: [], outcomes: [] };
  }
  const day = value as Partial<TradeDay>;
  return {
    candidates: Array.isArray(day.candidates) ? day.candidates : [],
    outcomes: Array.isArray(day.outcomes) ? day.outcomes : [],
  };
}

async function mgetAll(redis: Redis, keys: string[]): Promise<unknown[]> {
  const values: unknown[] = [];
  for (let index = 0; index < keys.length; index += READ_BATCH_SIZE) {
    const batch = keys.slice(index, index + READ_BATCH_SIZE);
    if (batch.length === 0) continue;
    values.push(...(await redis.mget<unknown[]>(...batch)));
  }
  return values;
}

/**
 * The journal as one request sees it.
 *
 * `rawRecords` holds only the settlement window, and is empty on the paths
 * that never price anything. `seeded` records that no cursor was found, the one
 * case where the raw read widens to the whole retention so the derived store
 * can be built from the records already saved.
 */
export type PaperJournalStore = {
  rawRecords: PaperScanRecord[];
  cursor: JournalCursor | null;
  scanDays: Map<string, JournalScanRow[]>;
  tradeDays: Map<string, TradeDay>;
  qualityRows: JournalQualityRow[];
  seeded: boolean;
};

async function readRawRecords(
  redis: Redis,
  prefix: string,
  fromMs: number,
  nowMs: number,
): Promise<PaperScanRecord[]> {
  const ids = await redis.zrange<string[]>(`${prefix}:index`, fromMs, nowMs, {
    byScore: true,
  });
  const values = await mgetAll(
    redis,
    ids.map((id) => `${prefix}:record:${id}`),
  );
  return values.filter(isPaperScanRecord);
}

async function readStore(
  redis: Redis,
  walletAddress: string,
  nowMs: number,
  needsRawPrices: boolean,
): Promise<PaperJournalStore> {
  const prefix = namespace(walletAddress);
  const cursorValue = await redis.get<unknown>(`${prefix}:d1:cursor`);
  const cursor = isJournalCursor(cursorValue) ? cursorValue : null;
  const retention = retentionFor(nowMs);
  const scanDates = [...retention.scanDates];
  const tradeDates = [...retention.tradeDates];
  const [scanValues, tradeValues] = await Promise.all([
    mgetAll(redis, scanDates.map((date) => `${prefix}:d1:scan:${date}`)),
    mgetAll(redis, tradeDates.map((date) => `${prefix}:d1:trade:${date}`)),
  ]);
  const scanDays = new Map(
    scanDates.map((date, index) => [date, scanRowsOf(scanValues[index])]),
  );
  const tradeDays = new Map(
    tradeDates.map((date, index) => [date, tradeDayOf(tradeValues[index])]),
  );
  const qualityBuckets = [...scanDays.values()]
    .flat()
    .filter(
      (row) =>
        row.bucketTimeMs >= retention.qualityFromMs &&
        row.bucketTimeMs <= nowMs,
    )
    .map((row) => row.bucketTimeMs);
  /*
   * Without a cursor the derived store has nothing to report, so the raw read
   * widens to the whole retention once, to build it from the records already
   * saved. Every later request pays for the settlement window alone.
   */
  const rawFromMs = cursor
    ? nowMs - RAW_WINDOW_MS
    : nowMs - JOURNAL_RECORD_WINDOW_DAYS * ONE_DAY_MS;
  const [qualityValues, rawRecords] = await Promise.all([
    mgetAll(
      redis,
      qualityBuckets.map(
        (bucketTimeMs) => `${prefix}:d1:quality:${bucketId(bucketTimeMs)}`,
      ),
    ),
    needsRawPrices || !cursor
      ? readRawRecords(redis, prefix, rawFromMs, nowMs)
      : Promise.resolve<PaperScanRecord[]>([]),
  ]);

  return {
    rawRecords,
    cursor,
    scanDays,
    tradeDays,
    qualityRows: qualityValues.filter(isQualityRow),
    seeded: cursor === null,
  };
}

function storeInput(store: PaperJournalStore): JournalInput {
  const tradeDays = [...store.tradeDays.values()];
  return journalInputFromStore({
    cursor: store.cursor,
    scanRows: [...store.scanDays.values()].flat(),
    qualityRows: store.qualityRows,
    candidates: tradeDays.flatMap((day) => day.candidates),
    outcomes: tradeDays.flatMap((day) => day.outcomes),
  });
}

function advanceInput(advance: JournalAdvance): JournalInput {
  return journalInputFromStore({
    cursor: advance.cursor,
    scanRows: advance.scanRows,
    qualityRows: advance.qualityRows,
    candidates: advance.candidates,
    outcomes: advance.outcomes,
  });
}

/**
 * Evaluates the journal from the derived store, or straight from the raw
 * records while no cursor has been written yet.
 */
function journalInput(
  store: PaperJournalStore,
  nowMs: number,
): JournalInput {
  return store.cursor
    ? storeInput(store)
    : advanceInput(advanceJournal(null, store.rawRecords, nowMs));
}

/**
 * The settlement window as storage holds it once `record` is saved.
 *
 * A record is keyed by its five-minute bucket, so a second scan inside one
 * bucket replaces the earlier record rather than adding one. Dropping the
 * superseded record keeps the in-memory window identical to a re-read.
 */
function withRecord(
  records: PaperScanRecord[],
  record: PaperScanRecord,
): PaperScanRecord[] {
  return [
    ...records.filter(
      (existing) => existing.bucketTimeMs !== record.bucketTimeMs,
    ),
    record,
  ];
}

type DerivedWrite = { key: string; value: unknown; ttlSeconds: number };

type AppliedAdvance = {
  store: PaperJournalStore;
  /** Day and quality rows; safe to write in any order and to repeat. */
  rows: DerivedWrite[];
  /** The cursor, written only once the rows it describes are stored. */
  cursor: DerivedWrite;
};

/**
 * Folds one advance into the day keys it belongs to.
 *
 * Scan rows and candidates are filed under the date they were observed,
 * outcomes under the date they were scored, which is what the drift and period
 * windows cut on. Rows are merged by bucket and by stream position, so
 * re-applying an advance cannot duplicate anything, and rows outside the
 * retention are dropped rather than written to a key nothing reads.
 */
function applyAdvance(
  store: PaperJournalStore,
  rawRecords: PaperScanRecord[],
  advance: JournalAdvance,
  retention: JournalRetention,
  prefix: string,
): AppliedAdvance {
  const scanDays = new Map(store.scanDays);
  const tradeDays = new Map(store.tradeDays);
  const scanDates = new Set<string>();
  const tradeDates = new Set<string>();

  for (const row of advance.scanRows) {
    const date = utcDate(row.bucketTimeMs);
    if (!retention.scanDates.has(date)) continue;
    const rows = scanDays.get(date) ?? [];
    scanDays.set(date, [
      ...rows.filter((existing) => existing.bucketTimeMs !== row.bucketTimeMs),
      row,
    ]);
    scanDates.add(date);
  }

  for (const candidate of advance.candidates) {
    const date = utcDate(candidate.entryBucketTimeMs);
    if (!retention.tradeDates.has(date)) continue;
    const day = tradeDays.get(date) ?? { candidates: [], outcomes: [] };
    tradeDays.set(date, {
      candidates: [
        ...day.candidates.filter(
          (existing) => existing.sequence !== candidate.sequence,
        ),
        candidate,
      ],
      outcomes: day.outcomes,
    });
    tradeDates.add(date);
  }

  for (const stored of advance.outcomes) {
    const date = utcDate(Date.parse(stored.outcome.outcomeTime));
    if (!retention.tradeDates.has(date)) continue;
    const day = tradeDays.get(date) ?? { candidates: [], outcomes: [] };
    tradeDays.set(date, {
      candidates: day.candidates,
      outcomes: [
        ...day.outcomes.filter(
          (existing) => existing.sequence !== stored.sequence,
        ),
        stored,
      ],
    });
    tradeDates.add(date);
  }

  const qualityRows = advance.qualityRows.filter(
    (row) => row.bucketTimeMs >= retention.qualityFromMs,
  );
  const rows: DerivedWrite[] = [
    ...[...scanDates].map((date) => ({
      key: `${prefix}:d1:scan:${date}`,
      value: scanDays.get(date) ?? [],
      ttlSeconds: DERIVED_TTL_SECONDS,
    })),
    ...[...tradeDates].map((date) => ({
      key: `${prefix}:d1:trade:${date}`,
      value: tradeDays.get(date) ?? { candidates: [], outcomes: [] },
      ttlSeconds: DERIVED_TTL_SECONDS,
    })),
    ...qualityRows.map((row) => ({
      key: `${prefix}:d1:quality:${bucketId(row.bucketTimeMs)}`,
      value: row,
      ttlSeconds: QUALITY_TTL_SECONDS,
    })),
  ];

  return {
    store: {
      rawRecords,
      cursor: advance.cursor,
      scanDays,
      tradeDays,
      qualityRows: [...store.qualityRows, ...qualityRows],
      seeded: store.seeded,
    },
    rows,
    cursor: {
      key: `${prefix}:d1:cursor`,
      value: advance.cursor,
      ttlSeconds: DERIVED_TTL_SECONDS,
    },
  };
}

/** Pipeline size cap, so seeding the store cannot send one oversized request. */
const WRITE_BATCH_SIZE = 200;

/**
 * Writes the rows first, then the cursor and the raw window together.
 *
 * The cursor is the claim that everything up to its bucket has been recorded,
 * and trimming the raw index is what makes the records behind that claim
 * unreadable. Both go last, so a write that fails part way leaves the previous
 * cursor and the untrimmed records in place and the next scan simply redoes it.
 */
async function writeScan(
  redis: Redis,
  record: PaperScanRecord,
  applied: AppliedAdvance,
): Promise<void> {
  const prefix = namespace(record.walletAddress);
  const indexKey = `${prefix}:index`;
  const rawWindowStart = record.bucketTimeMs - RAW_WINDOW_MS;

  for (
    let index = 0;
    index < applied.rows.length;
    index += WRITE_BATCH_SIZE
  ) {
    const batch = redis.pipeline();
    for (const write of applied.rows.slice(index, index + WRITE_BATCH_SIZE)) {
      batch.set(write.key, write.value, { ex: write.ttlSeconds });
    }
    await batch.exec();
  }

  const pipeline = redis.pipeline();
  pipeline.set(`${prefix}:record:${record.id}`, record, { ex: RAW_TTL_SECONDS });
  pipeline.zadd(indexKey, { score: record.bucketTimeMs, member: record.id });
  pipeline.zremrangebyscore(indexKey, 0, rawWindowStart - 1);
  pipeline.expire(indexKey, RAW_TTL_SECONDS);
  pipeline.set(applied.cursor.key, applied.cursor.value, {
    ex: applied.cursor.ttlSeconds,
  });
  await pipeline.exec();
}

async function trackedTrendPrices(
  records: PaperScanRecord[],
  nowMs: number,
): Promise<Record<string, number>> {
  const activeAfter = nowMs - TREND_PRICE_TRACKING_MS;
  const addresses = [...new Set(
    records
      .filter((record) => record.bucketTimeMs >= activeAfter)
      .flatMap((record) => record.signals)
      .filter(
        (signal) =>
          signal.model === "community-trend" &&
          typeof signal.contractAddress === "string",
      )
      .map((signal) => signal.contractAddress!.toLowerCase()),
  )].slice(0, MAX_TRACKED_TREND_TOKENS);

  if (addresses.length === 0) return {};
  const markets = await getTokenMarkets(addresses);
  const prices: Record<string, number> = {};
  for (const address of addresses) {
    const price = markets.get(address)?.priceUsd;
    if (typeof price === "number" && Number.isFinite(price) && price > 0) {
      prices[address] = price;
    }
  }
  return prices;
}

/**
 * One journal read together with its evaluation.
 *
 * The scan path appends to `store` instead of reading the journal again, which
 * is what keeps a scan to a single pass over storage. `store` is null when the
 * journal could not be read at all.
 */
export type PaperJournalContext = {
  store: PaperJournalStore | null;
  snapshot: PaperJournalSnapshot;
};

const DISABLED_MESSAGE =
  "永続ストレージ未接続のため、7日判定・30日分析はまだ開始していません。";
const ERROR_MESSAGE =
  "記録ストレージへ接続できませんでした。実売買はロックされたままです。";

export async function readPaperJournalContext(
  walletAddress: string,
  nowMs = Date.now(),
): Promise<PaperJournalContext> {
  const redis = getRedis();
  if (!redis) {
    return {
      store: null,
      snapshot: emptyPaperJournal("disabled", DISABLED_MESSAGE),
    };
  }

  try {
    const store = await readStore(redis, walletAddress, nowMs, true);
    return {
      store,
      snapshot: evaluateJournalInput(journalInput(store, nowMs), nowMs),
    };
  } catch {
    return { store: null, snapshot: emptyPaperJournal("error", ERROR_MESSAGE) };
  }
}

export async function getPaperJournalSnapshot(
  walletAddress: string,
  nowMs = Date.now(),
): Promise<PaperJournalSnapshot> {
  return (await readPaperJournalContext(walletAddress, nowMs)).snapshot;
}

/**
 * The journal as the health endpoint needs it.
 *
 * Health reports scan freshness, the readiness gate and the 24h source
 * statistics, none of which need a price. Skipping the settlement window keeps
 * the endpoint off the raw records entirely.
 */
export async function getPaperJournalHealth(
  walletAddress: string,
  nowMs = Date.now(),
): Promise<PaperJournalSnapshot> {
  const redis = getRedis();
  if (!redis) return emptyPaperJournal("disabled", DISABLED_MESSAGE);

  try {
    const store = await readStore(redis, walletAddress, nowMs, false);
    return evaluateJournalInput(journalInput(store, nowMs), nowMs);
  } catch {
    return emptyPaperJournal("error", ERROR_MESSAGE);
  }
}

export async function getPaperJournalResearchExport(
  walletAddress: string,
  nowMs = Date.now(),
): Promise<{
  outcomes: PaperTradeOutcome[];
  journal: PaperJournalSnapshot;
}> {
  const redis = getRedis();
  if (!redis) throw new Error("Paper journal storage is unavailable.");
  const store = await readStore(redis, walletAddress, nowMs, false);
  const input = journalInput(store, nowMs);
  const analyticsWindowStart =
    nowMs - JOURNAL_ANALYTICS_WINDOW_DAYS * ONE_DAY_MS;
  return {
    outcomes: input.outcomes
      .filter(
        (stored) =>
          Date.parse(stored.outcome.outcomeTime) >= analyticsWindowStart,
      )
      .toSorted((left, right) => left.sequence - right.sequence)
      .map((stored) => stored.outcome),
    journal: evaluateJournalInput(input, nowMs),
  };
}

export async function getPaperJournalExportOutcomes(
  walletAddress: string,
  nowMs = Date.now(),
): Promise<PaperTradeOutcome[]> {
  const result = await getPaperJournalResearchExport(walletAddress, nowMs);
  return result.outcomes;
}

export async function recordPaperScan(
  data: DashboardData,
  nowMs = Date.now(),
  preloadedStore?: PaperJournalStore | null,
): Promise<PaperJournalSnapshot> {
  const redis = getRedis();
  if (!redis) {
    return emptyPaperJournal(
      "disabled",
      "永続ストレージ未接続のため、このスキャンは保存されませんでした。",
    );
  }

  try {
    const store =
      preloadedStore ??
      (await readStore(redis, data.snapshot.walletAddress, nowMs, true));
    if (store.seeded) {
      console.info("[paper.journal.seed] building the derived store", {
        retainedRecords: store.rawRecords.length,
      });
    }
    const trendPrices = await trackedTrendPrices(store.rawRecords, nowMs);
    const record = createPaperScanRecord(data, nowMs, trendPrices);
    const rawRecords = withRecord(store.rawRecords, record);
    const advance = advanceJournal(store.cursor, rawRecords, nowMs);
    const applied = applyAdvance(
      store,
      rawRecords,
      advance,
      retentionFor(nowMs),
      namespace(record.walletAddress),
    );
    await writeScan(redis, record, applied);
    return evaluateJournalInput(storeInput(applied.store), nowMs);
  } catch {
    return emptyPaperJournal(
      "error",
      "スキャンの保存または採点に失敗しました。実売買はロックされたままです。",
    );
  }
}
