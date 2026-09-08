import { afterEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/safety/emergency-stop/route";

const originalSecret = process.env.SAFETY_CONTROL_SECRET;

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.SAFETY_CONTROL_SECRET;
  } else {
    process.env.SAFETY_CONTROL_SECRET = originalSecret;
  }
});

describe("emergency stop route", () => {
  it("stays locked until a strong control secret is configured", async () => {
    delete process.env.SAFETY_CONTROL_SECRET;
    const response = await GET(new Request("http://localhost/api/safety/emergency-stop"));
    expect(response.status).toBe(503);
  });

  it("rejects requests without the bearer secret", async () => {
    process.env.SAFETY_CONTROL_SECRET = "a-strong-test-secret-value";
    const response = await GET(new Request("http://localhost/api/safety/emergency-stop"));
    expect(response.status).toBe(401);
  });
});
