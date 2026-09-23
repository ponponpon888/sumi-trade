import "server-only";

import { Redis } from "@upstash/redis";

import {
  BASE_COST_BUCKET_MS,
  BASE_COST_RECORD_WINDOW_DAYS,
  BASE_COST_REQUESTED_YEN,
  baseCostBucketId,
  createObservedBaseCostRecord,
  createUnavailableBaseCostRecord,
  isBaseCostRecord,
  summarizeBaseCost,
  type BaseCostRecord,
  type BaseCostSummary,
} from "@/lib/base-cost-observation-core";
import { BasePaperQuoteError, getBasePaperQuote } from "@/lib/base-paper-quote";

const NAMESPACE = "sumi:base-cost:v1";
const INDEX_KEY = `${NAMESPACE}:index`;
const RECORD_TTL_SECONDS = 32 * 24 * 60 * 60;
const CLAIM_TTL_SECONDS = 2 * 60 * 60;
const WINDOW_MS = BASE_COST_RECORD_WINDOW_DAYS * 24 * 60 * 60 * 1_000;

function getRedis(): Redis | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim();
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim();
  return url && token ? new Redis({ url, token, enableTelemetry: false }) : null;
}

export type BaseCostObservationResult =
  | { status: "recorded"; record: BaseCostRecord }
  | { status: "skipped-duplicate"; bucketId: string }
  | { status: "storage-unavailable" };

/**
 * Takes at most one Base round-trip quote per hour. The hour is claimed in
 * Redis before any provider request, so a retried or overlapping cron run
 * never spends a second quote in the same hour. GET-only: no wallet, calldata,
 * approval, signature or transaction.
 */
export async function recordBaseCostObservation(
  nowMs = Date.now(),
): Promise<BaseCostObservationResult> {
  const redis = getRedis();
  if (!redis) return { status: "storage-unavailable" };
  const bucketId = baseCostBucketId(nowMs);
  const claimed = await redis.set(`${NAMESPACE}:claim:${bucketId}`, nowMs, {
    nx: true,
    ex: CLAIM_TTL_SECONDS,
  });
  if (claimed !== "OK") return { status: "skipped-duplicate", bucketId };

  let record: BaseCostRecord;
  try {
    const quote = await getBasePaperQuote(BASE_COST_REQUESTED_YEN);
    record = createObservedBaseCostRecord(quote, Date.now());
  } catch (error) {
    record = createUnavailableBaseCostRecord(
      error instanceof BasePaperQuoteError ? error.code : "UNKNOWN",
      Date.now(),
    );
  }

  // Keep the record in the claimed hour even if the quote finished after it.
  const stored: BaseCostRecord = {
    ...record,
    id: bucketId,
    bucketTimeMs: Math.floor(nowMs / BASE_COST_BUCKET_MS) * BASE_COST_BUCKET_MS,
  };
  const pipeline = redis.pipeline();
  pipeline.set(`${NAMESPACE}:record:${bucketId}`, stored, { ex: RECORD_TTL_SECONDS });
  pipeline.zadd(INDEX_KEY, { score: stored.bucketTimeMs, member: bucketId });
  pipeline.zremrangebyscore(INDEX_KEY, 0, stored.bucketTimeMs - WINDOW_MS - 1);
  pipeline.expire(INDEX_KEY, RECORD_TTL_SECONDS);
  await pipeline.exec();
  return { status: "recorded", record: stored };
}

export async function getBaseCostSummary(
  nowMs = Date.now(),
): Promise<BaseCostSummary | null> {
  const redis = getRedis();
  if (!redis) return null;
  const ids = await redis.zrange<string[]>(INDEX_KEY, nowMs - WINDOW_MS, nowMs, {
    byScore: true,
  });
  const records: BaseCostRecord[] = [];
  if (ids.length) {
    const values = await redis.mget<unknown[]>(
      ...ids.map((id) => `${NAMESPACE}:record:${id}`),
    );
    for (const value of values) if (isBaseCostRecord(value)) records.push(value);
  }
  return summarizeBaseCost(records, nowMs);
}
