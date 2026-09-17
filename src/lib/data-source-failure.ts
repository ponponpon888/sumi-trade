import { z } from "zod";

import type {
  DataSourceCheckResult,
  DataSourceFailureBreakdown,
  DataSourceFailureKind,
} from "@/lib/types";

/** Thrown by source adapters for a non-OK HTTP status so the status can be classified. */
export class DataSourceHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DataSourceHttpError";
  }
}

/** Thrown by source adapters when a response body has an unexpected shape. */
export class DataSourceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataSourceParseError";
  }
}

export function classifyDataSourceFailure(error: unknown): DataSourceFailureKind {
  if (error instanceof DataSourceHttpError) {
    return error.status === 429 ? "rate-limited" : "http-error";
  }
  if (
    error instanceof DataSourceParseError ||
    error instanceof z.ZodError ||
    error instanceof SyntaxError
  ) {
    return "parse-error";
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return "timeout";
  }
  return "other";
}

export function emptyFailureBreakdown(): DataSourceFailureBreakdown {
  return { rateLimited: 0, timeout: 0, httpError: 0, parseError: 0, other: 0 };
}

const BREAKDOWN_KEY: Record<DataSourceFailureKind, keyof DataSourceFailureBreakdown> = {
  "rate-limited": "rateLimited",
  timeout: "timeout",
  "http-error": "httpError",
  "parse-error": "parseError",
  other: "other",
};

export function failureBreakdownOf(
  results: readonly DataSourceCheckResult[],
): DataSourceFailureBreakdown {
  const breakdown = emptyFailureBreakdown();
  for (const result of results) {
    if (result.outcome !== "source-unavailable") continue;
    breakdown[BREAKDOWN_KEY[result.failureKind ?? "other"]] += 1;
  }
  return breakdown;
}

export function sourceUnavailable(error: unknown): DataSourceCheckResult {
  return { outcome: "source-unavailable", failureKind: classifyDataSourceFailure(error) };
}
