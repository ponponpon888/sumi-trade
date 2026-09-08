import "server-only";

import { Redis } from "@upstash/redis";

import { getTokenMarkets } from "@/lib/dexscreener";
import {
  createPaperScanRecord,
  emptyPaperJournal,
  evaluatePaperJournal,
  JOURNAL_RECORD_WINDOW_DAYS,
  OUTCOME_HORIZON_HOURS,
} from "@/lib/paper-journal-core";
import type {
  ChartModelSnapshot,
  PaperJournalSnapshot,
  PaperScanRecord,
  PortfolioSnapshot,
  StrategyPlan,
  TrendScoutSnapshot,
} from "@/lib/types";

const RECORD_TTL_SECONDS = 32 * 24 * 60 * 60;
const READ_BATCH_SIZE = 250;

type DashboardData = {
  snapshot: PortfolioSnapshot;
  chartModel: ChartModelSnapshot;
  plan: StrategyPlan;
  trendScout?: TrendScoutSnapshot;
};

const TREND_PRICE_TRACKING_MS =
  (OUTCOME_HORIZON_HOURS * 60 + 90) * 60 * 1_000;
const MAX_TRACKED_TREND_TOKENS = 20;

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

async function readRecords(
  redis: Redis,
  walletAddress: string,
  nowMs: number,
): Promise<PaperScanRecord[]> {
  const prefix = namespace(walletAddress);
  const indexKey = `${prefix}:index`;
  const windowStart =
    nowMs - JOURNAL_RECORD_WINDOW_DAYS * 24 * 60 * 60 * 1_000;
  const ids = await redis.zrange<string[]>(indexKey, windowStart, nowMs, {
    byScore: true,
  });
  const records: PaperScanRecord[] = [];

  for (let index = 0; index < ids.length; index += READ_BATCH_SIZE) {
    const batch = ids.slice(index, index + READ_BATCH_SIZE);
    const keys = batch.map((id) => `${prefix}:record:${id}`);
    const values = await redis.mget<unknown[]>(...keys);
    for (const value of values) {
      if (isPaperScanRecord(value)) records.push(value);
    }
  }

  return records;
}

async function saveRecord(redis: Redis, record: PaperScanRecord): Promise<void> {
  const prefix = namespace(record.walletAddress);
  const indexKey = `${prefix}:index`;
  const recordKey = `${prefix}:record:${record.id}`;
  const windowStart =
    record.bucketTimeMs - JOURNAL_RECORD_WINDOW_DAYS * 24 * 60 * 60 * 1_000;
  const pipeline = redis.pipeline();
  pipeline.set(recordKey, record, { ex: RECORD_TTL_SECONDS });
  pipeline.zadd(indexKey, {
    score: record.bucketTimeMs,
    member: record.id,
  });
  pipeline.zremrangebyscore(indexKey, 0, windowStart - 1);
  pipeline.expire(indexKey, RECORD_TTL_SECONDS);
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

export async function getPaperJournalSnapshot(
  walletAddress: string,
  nowMs = Date.now(),
): Promise<PaperJournalSnapshot> {
  const redis = getRedis();
  if (!redis) {
    return emptyPaperJournal(
      "disabled",
      "永続ストレージ未接続のため、7日判定・30日分析はまだ開始していません。",
    );
  }

  try {
    const records = await readRecords(redis, walletAddress, nowMs);
    return evaluatePaperJournal(records, nowMs);
  } catch {
    return emptyPaperJournal(
      "error",
      "記録ストレージへ接続できませんでした。実売買はロックされたままです。",
    );
  }
}

export async function recordPaperScan(
  data: DashboardData,
  nowMs = Date.now(),
): Promise<PaperJournalSnapshot> {
  const redis = getRedis();
  if (!redis) {
    return emptyPaperJournal(
      "disabled",
      "永続ストレージ未接続のため、このスキャンは保存されませんでした。",
    );
  }

  try {
    const existingRecords = await readRecords(
      redis,
      data.snapshot.walletAddress,
      nowMs,
    );
    const trendPrices = await trackedTrendPrices(existingRecords, nowMs);
    const record = createPaperScanRecord(data, nowMs, trendPrices);
    await saveRecord(redis, record);
    const records = await readRecords(redis, record.walletAddress, nowMs);
    return evaluatePaperJournal(records, nowMs);
  } catch {
    return emptyPaperJournal(
      "error",
      "スキャンの保存または採点に失敗しました。実売買はロックされたままです。",
    );
  }
}
