import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  classifyDataSourceFailure,
  DataSourceHttpError,
  DataSourceParseError,
  failureBreakdownOf,
  sourceUnavailable,
} from "@/lib/data-source-failure";

describe("data source failure classification", () => {
  it("classifies HTTP status failures", () => {
    expect(classifyDataSourceFailure(new DataSourceHttpError(429, "limited"))).toBe("rate-limited");
    expect(classifyDataSourceFailure(new DataSourceHttpError(500, "server"))).toBe("http-error");
    expect(classifyDataSourceFailure(new DataSourceHttpError(403, "forbidden"))).toBe("http-error");
  });

  it("classifies parse failures", () => {
    const zodError = (() => {
      try {
        z.object({ value: z.number() }).parse({ value: "x" });
      } catch (error) {
        return error;
      }
    })();
    expect(classifyDataSourceFailure(zodError)).toBe("parse-error");
    expect(classifyDataSourceFailure(new SyntaxError("Unexpected token"))).toBe("parse-error");
    expect(classifyDataSourceFailure(new DataSourceParseError("shape"))).toBe("parse-error");
  });

  it("classifies timeouts and aborts", () => {
    expect(classifyDataSourceFailure(new DOMException("timed out", "TimeoutError"))).toBe("timeout");
    expect(classifyDataSourceFailure(new DOMException("aborted", "AbortError"))).toBe("timeout");
  });

  it("classifies anything else as other", () => {
    expect(classifyDataSourceFailure(new TypeError("fetch failed"))).toBe("other");
    expect(classifyDataSourceFailure("unexpected")).toBe("other");
    expect(classifyDataSourceFailure(null)).toBe("other");
  });

  it("counts only source-unavailable checks in the breakdown", () => {
    expect(
      failureBreakdownOf([
        sourceUnavailable(new DataSourceHttpError(429, "limited")),
        sourceUnavailable(new DOMException("timed out", "TimeoutError")),
        { outcome: "source-unavailable" },
        { outcome: "policy-blocked" },
        { outcome: "source-stale" },
        { outcome: "success" },
      ]),
    ).toEqual({ rateLimited: 1, timeout: 1, httpError: 0, parseError: 0, other: 1 });
  });
});
