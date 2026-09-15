import { afterEach, describe, expect, it, vi } from "vitest";

const { getObservation } = vi.hoisted(() => ({ getObservation: vi.fn() }));
vi.mock("@/lib/base-wallet-observation", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/base-wallet-observation")>(),
  getBaseWalletObservation: getObservation,
}));
import { GET } from "@/app/api/paper/base-wallet/route";

function authenticated(query = "") {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("DASHBOARD_USER", "sumi");
  vi.stubEnv("DASHBOARD_PASSWORD", "test-only-password-0123456789");
  return new Request(`https://sumi.example/api/paper/base-wallet${query}`, {
    headers: {
      authorization: `Basic ${Buffer.from("sumi:test-only-password-0123456789").toString("base64")}`,
    },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("authenticated Base wallet observation route", () => {
  it("requires authentication before RPC work", async () => {
    authenticated();
    const response = await GET(new Request("https://sumi.example/api/paper/base-wallet"));
    expect(response.status).toBe(401);
    expect(getObservation).not.toHaveBeenCalled();
  });

  it("rejects query parameters before RPC work", async () => {
    const response = await GET(authenticated("?address=0x1111111111111111111111111111111111111111"));
    expect(response.status).toBe(400);
    expect(getObservation).not.toHaveBeenCalled();
  });

  it("returns a private uncached locked observation", async () => {
    getObservation.mockResolvedValueOnce({
      mode: "paper",
      status: "observed",
      readiness: "blocked",
      executionLocked: true,
      nativeBalanceWei: "1",
    });
    const response = await GET(authenticated());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      executionLocked: true,
      nativeBalanceWei: "1",
    });
  });

  it("returns only the stable code for expected failures", async () => {
    const { BaseWalletObservationError } = await import("@/lib/base-wallet-observation");
    getObservation.mockRejectedValueOnce(
      new BaseWalletObservationError("BASE_RPC_WRONG_CHAIN"),
    );
    const response = await GET(authenticated());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      mode: "paper",
      executionLocked: true,
      readiness: "blocked",
      status: "unavailable",
      error: "BASE_RPC_WRONG_CHAIN",
    });
  });
});

