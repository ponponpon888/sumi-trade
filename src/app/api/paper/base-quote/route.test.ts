import { afterEach, describe, expect, it, vi } from "vitest";

const { getQuote } = vi.hoisted(() => ({ getQuote: vi.fn() }));
vi.mock("@/lib/base-paper-quote", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/base-paper-quote")>(),
  getBasePaperQuote: getQuote,
}));
import { GET } from "@/app/api/paper/base-quote/route";

function authenticated(query = "amountYen=500") {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("DASHBOARD_USER", "sumi");
  vi.stubEnv("DASHBOARD_PASSWORD", "test-only-password-0123456789");
  return new Request(`https://sumi.example/api/paper/base-quote?${query}`, {
    headers: { authorization: `Basic ${Buffer.from("sumi:test-only-password-0123456789").toString("base64")}` },
  });
}

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("authenticated Base paper quote route", () => {
  it("requires authentication before external work", async () => {
    authenticated();
    const result = await GET(new Request("https://sumi.example/api/paper/base-quote?amountYen=500"));
    expect(result.status).toBe(401);
    expect(getQuote).not.toHaveBeenCalled();
  });

  it("locks access when production authentication is missing", async () => {
    const request = authenticated();
    vi.stubEnv("DASHBOARD_PASSWORD", "");
    expect((await GET(request)).status).toBe(503);
    expect(getQuote).not.toHaveBeenCalled();
  });

  it.each(["", "amountYen=1001", "amountYen=0500", "amountYen=500&amountYen=1000",
    "amountYen=500&token=anything", "amountYen=500&url=https://other.example"])(
    "rejects unsupported request %s without calling providers", async (query) => {
      expect((await GET(authenticated(query))).status).toBe(400);
      expect(getQuote).not.toHaveBeenCalled();
    },
  );

  it.each([500, 1000])("returns a private uncached observation for %s yen", async (amount) => {
    getQuote.mockResolvedValueOnce({ status: "observed", executionLocked: true, readiness: "blocked", totalCostYen: null });
    const result = await GET(authenticated(`amountYen=${amount}`));
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(getQuote).toHaveBeenCalledWith(amount);
    expect(await result.json()).toMatchObject({ executionLocked: true, totalCostYen: null });
  });

  it("returns a generic locked response after unexpected failure", async () => {
    getQuote.mockRejectedValueOnce(new Error("private upstream body"));
    const result = await GET(authenticated());
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({
      status: "unavailable", executionLocked: true, readiness: "blocked", error: "QUOTE_UNAVAILABLE",
    });
  });
});
