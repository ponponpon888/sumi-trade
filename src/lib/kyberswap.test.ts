import { afterEach, describe, expect, it, vi } from "vitest";

import { getQuotePreflightAssessments } from "@/lib/kyberswap";

const TOKEN = "0x00000000000000000000000000000000000000d1";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("KyberSwap quote failure kinds", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["rate-limited", async () => json({}, 429)],
    ["http-error", async () => json({}, 503)],
    ["parse-error", async () => json({ code: 0, data: {} })],
    ["timeout", async () => {
      throw new DOMException("timed out", "TimeoutError");
    }],
  ] as const)("records %s as an unavailable quote", async (failureKind, response) => {
    vi.stubGlobal("fetch", vi.fn(response));
    const result = (await getQuotePreflightAssessments([TOKEN], 2_500)).get(TOKEN);
    expect(result).toMatchObject({ status: "unavailable", failureKind });
  });

  it("keeps a missing route as a policy block without a failure kind", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "route not found" }, 404)));
    const result = (await getQuotePreflightAssessments([TOKEN], 2_500)).get(TOKEN);
    expect(result?.status).toBe("blocked");
    expect(result).not.toHaveProperty("failureKind");
  });
});
