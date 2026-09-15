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

  it("passes execution state fields through unchanged", async () => {
    const body = {
      mode: "paper",
      executionLocked: true,
      profitabilityVerified: false,
      status: "blocked",
      readiness: "blocked",
      reserveSufficient: null,
      rpcRequests: 1,
      walletRpcRequests: 1,
      executionStateRpcRequests: 1,
      totalRpcRequests: 2,
      externalHttpRequests: 5,
      routerAddress: "0x2222222222222222222222222222222222222222",
      smartAccountDeployed: false,
      usdcAllowanceUnits: "0",
      buyLegAllowanceRequired: false,
      sellLegInputUsdcUnits: "2487500",
      sellLegAllowanceCovered: false,
      blockReasons: [
        "INSUFFICIENT_NATIVE_BALANCE", "SMART_ACCOUNT_UNDEPLOYED", "SELL_ALLOWANCE_INSUFFICIENT",
        "EXECUTION_LOCKED", "PREFLIGHT_CHECKS_INCOMPLETE",
      ],
      incompleteChecks: [
        "L1_FEE_COVERAGE_UNVERIFIED", "TOKEN_APPROVAL_COST_UNVERIFIED", "SIGNER_FEES_UNVERIFIED",
        "EXECUTION_VALUATION_UNVERIFIED", "SMART_ACCOUNT_DEPLOYMENT_COST_UNVERIFIED",
      ],
    };
    getPreflight.mockResolvedValueOnce(body);
    const result = await GET(authenticated());
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await result.json()).toEqual(body);
  });

  it.each([
    ["BASE_EXECUTION_STATE_UNAVAILABLE", "BASE_RPC_STALE_BLOCK", "BASE_RPC_STALE_BLOCK"],
    ["BASE_EXECUTION_STATE_UNAVAILABLE", "BASE_EXECUTION_STATE_UNEXPECTED_CODE", "BASE_EXECUTION_STATE_UNEXPECTED_CODE"],
    ["BASE_EXECUTION_STATE_UNAVAILABLE", "https://rpc.example/private-secret", null],
    ["PREFLIGHT_INVALID_OBSERVATION", "BASE_EXECUTION_STATE_INPUT_INVALID", "BASE_EXECUTION_STATE_INPUT_INVALID"],
    ["PREFLIGHT_OBSERVATION_MISMATCH", "BASE_RPC_STALE_BLOCK", null],
  ] as const)("returns stable execution state failure %s with source %s", async (code, source, expected) => {
    getPreflight.mockRejectedValueOnce(new BasePaperPreflightError(code, source));
    const result = await GET(authenticated());
    const text = await result.text();
    expect(result.status).toBe(503);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(JSON.parse(text)).toEqual({
      mode: "paper",
      executionLocked: true,
      profitabilityVerified: false,
      readiness: "blocked",
      status: "unavailable",
      error: code,
      sourceError: expected,
    });
    expect(text).not.toContain("secret");
  });
});
