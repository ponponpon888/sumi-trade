import { afterEach, describe, expect, it, vi } from "vitest";

import { getOnchainPreflightAssessments } from "@/lib/ethereum-preflight";

const TOKEN = "0x00000000000000000000000000000000000000c1";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Ethereum RPC preflight failure kinds", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("marks a missing RPC configuration as other", async () => {
    vi.stubEnv("ETHEREUM_RPC_URL", "");
    const result = (await getOnchainPreflightAssessments([TOKEN])).get(TOKEN);
    expect(result).toMatchObject({ status: "unavailable", failureKind: "other" });
  });

  it.each([
    ["rate-limited", async () => json({}, 429)],
    ["http-error", async () => json({}, 502)],
    ["parse-error", async () => json({ not: "a batch" })],
    ["parse-error", async () => json([{ id: 1, result: "0x1" }])],
    ["timeout", async () => {
      throw new DOMException("timed out", "TimeoutError");
    }],
  ] as const)("records %s", async (failureKind, response) => {
    vi.stubEnv("ETHEREUM_RPC_URL", "https://rpc.example.test");
    vi.stubGlobal("fetch", vi.fn(response));
    const result = (await getOnchainPreflightAssessments([TOKEN])).get(TOKEN);
    expect(result).toMatchObject({ status: "unavailable", failureKind });
  });

  it("does not attach a failure kind to a complete response", async () => {
    vi.stubEnv("ETHEREUM_RPC_URL", "https://rpc.example.test");
    const nowSeconds = Math.floor(Date.now() / 1_000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json([
          { id: 1, result: "0x1" },
          { id: 2, result: { number: "0x10", timestamp: `0x${nowSeconds.toString(16)}` } },
          { id: 100, result: "0x6080" },
        ]),
      ),
    );
    const result = (await getOnchainPreflightAssessments([TOKEN])).get(TOKEN);
    expect(result?.status).toBe("pass");
    expect(result).not.toHaveProperty("failureKind");
  });
});
