import { afterEach, describe, expect, it, vi } from "vitest";

const { recordObservation } = vi.hoisted(() => ({ recordObservation: vi.fn() }));
vi.mock("@/lib/base-cost-observation", () => ({
  recordBaseCostObservation: recordObservation,
}));
import { GET } from "@/app/api/cron/base-cost/route";

const SECRET = "test-only-cron-secret-0123456789";

function request(authorization?: string) {
  return new Request("https://sumi.example/api/cron/base-cost", {
    headers: authorization ? { authorization } : {},
  });
}

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("Base cost cron route", () => {
  it("stays closed until CRON_SECRET is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request(`Bearer ${SECRET}`))).status).toBe(503);
    expect(recordObservation).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret before any provider work", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await GET(request("Bearer wrong"))).status).toBe(401);
    expect((await GET(request())).status).toBe(401);
    expect(recordObservation).not.toHaveBeenCalled();
  });

  it("records one observation and keeps execution locked", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    recordObservation.mockResolvedValue({ status: "skipped-duplicate", bucketId: "b" });
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      mode: "paper",
      executionLocked: true,
      status: "skipped-duplicate",
    });
  });

  it("returns 503 without raw error text when storage fails", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    recordObservation.mockResolvedValueOnce({ status: "storage-unavailable" });
    expect((await GET(request(`Bearer ${SECRET}`))).status).toBe(503);
    recordObservation.mockRejectedValueOnce(new Error("redis https://secret.example token=abc"));
    const failed = await GET(request(`Bearer ${SECRET}`));
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("secret.example");
  });
});
