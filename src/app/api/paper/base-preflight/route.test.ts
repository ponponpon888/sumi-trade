import { afterEach, describe, expect, it, vi } from "vitest";

const { getPreflight } = vi.hoisted(() => ({ getPreflight: vi.fn() }));
vi.mock("@/lib/base-paper-preflight", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/base-paper-preflight")>(),
  getBasePaperPreflight: getPreflight,
}));
import { GET } from "@/app/api/paper/base-preflight/route";
import { BasePaperPreflightError } from "@/lib/base-paper-preflight";

function authenticated(query = "amountYen=500") {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("DASHBOARD_USER", "sumi");
  vi.stubEnv("DASHBOARD_PASSWORD", "test-only-password-0123456789");
  return new Request(`https://sumi.example/api/paper/base-preflight?${query}`, {
    headers: { authorization: `Basic ${Buffer.from("sumi:test-only-password-0123456789").toString("base64")}` },
  });
}

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("authenticated Base paper preflight route", () => {
  it("requires authentication before observation", async () => {
    authenticated();
    const result = await GET(new Request("https://sumi.example/api/paper/base-preflight?amountYen=500"));
    expect(result.status).toBe(401);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(getPreflight).not.toHaveBeenCalled();
  });

  it("locks access when production authentication is missing", async () => {
    const request = authenticated();
    vi.stubEnv("DASHBOARD_PASSWORD", "");
    expect((await GET(request)).status).toBe(503);
    expect(getPreflight).not.toHaveBeenCalled();
  });

  it.each(["", "amountYen=1001", "amountYen=0500", "amountYen=", "amountYen=500&amountYen=500",
    "amountYen=500&amountYen=1000", "amountYen=500&token=anything", "amountYen=500&url=https://other.example"])(
    "rejects unsupported request %s without observation", async (query) => {
      const result = await GET(authenticated(query));
      expect(result.status).toBe(400);
      expect(result.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(getPreflight).not.toHaveBeenCalled();
    },
  );

  it.each([500, 1000])("returns a private uncached blocked preflight for %s yen", async (amount) => {
    getPreflight.mockResolvedValueOnce({
      mode: "paper", executionLocked: true, status: "blocked", readiness: "blocked", swapInputCovered: true,
    });
    const result = await GET(authenticated(`amountYen=${amount}`));
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(result.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(getPreflight).toHaveBeenCalledTimes(1);
    expect(getPreflight).toHaveBeenCalledWith(amount);
    expect(await result.json()).toMatchObject({ executionLocked: true, status: "blocked", readiness: "blocked" });
  });

  it("returns only stable codes for expected failures", async () => {
    getPreflight.mockRejectedValueOnce(new BasePaperPreflightError("BASE_QUOTE_UNAVAILABLE", "PRICE_STALE"));
    const result = await GET(authenticated());
    expect(result.status).toBe(503);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await result.json()).toEqual({
      mode: "paper",
      executionLocked: true,
      profitabilityVerified: false,
      readiness: "blocked",
      status: "unavailable",
      error: "BASE_QUOTE_UNAVAILABLE",
      sourceError: "PRICE_STALE",
    });
  });

  it("does not expose a non-allowlisted source code", async () => {
    getPreflight.mockRejectedValueOnce(
      new BasePaperPreflightError("BASE_WALLET_UNAVAILABLE", "https://rpc.example/private-secret"),
    );
    const result = await GET(authenticated());
    const text = await result.text();
    expect(result.status).toBe(503);
    expect(JSON.parse(text)).toMatchObject({ error: "BASE_WALLET_UNAVAILABLE", sourceError: null });
    expect(text).not.toContain("secret");
  });

  it("returns a generic locked response after unexpected failure", async () => {
    getPreflight.mockRejectedValueOnce(new Error("private upstream body secret"));
    const result = await GET(authenticated());
    const text = await result.text();
    expect(result.status).toBe(503);
    expect(JSON.parse(text)).toMatchObject({
      status: "unavailable", executionLocked: true, readiness: "blocked",
      error: "BASE_PREFLIGHT_UNAVAILABLE", sourceError: null,
    });
    expect(text).not.toContain("secret");
  });
});
