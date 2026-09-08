import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "@/proxy";

const originalVercel = process.env.VERCEL;
const originalUser = process.env.DASHBOARD_USER;
const originalPassword = process.env.DASHBOARD_PASSWORD;

afterEach(() => {
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
  if (originalUser === undefined) delete process.env.DASHBOARD_USER;
  else process.env.DASHBOARD_USER = originalUser;
  if (originalPassword === undefined) delete process.env.DASHBOARD_PASSWORD;
  else process.env.DASHBOARD_PASSWORD = originalPassword;
});

describe("production dashboard proxy", () => {
  it("does not require dashboard credentials outside Vercel", () => {
    delete process.env.VERCEL;
    const response = proxy(new NextRequest("http://localhost:3000/"));
    expect(response.status).toBe(200);
  });

  it("fails closed on Vercel when no password is configured", () => {
    process.env.VERCEL = "1";
    delete process.env.DASHBOARD_PASSWORD;
    const response = proxy(new NextRequest("https://example.vercel.app/"));
    expect(response.status).toBe(503);
  });

  it("challenges incorrect credentials", () => {
    process.env.VERCEL = "1";
    process.env.DASHBOARD_PASSWORD = "correct-horse";
    const request = new NextRequest("https://example.vercel.app/", {
      headers: {
        Authorization: `Basic ${Buffer.from("sumi:wrong").toString("base64")}`,
      },
    });
    const response = proxy(request);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("SUMI TRADE LAB");
  });

  it("allows exact credentials", () => {
    process.env.VERCEL = "1";
    process.env.DASHBOARD_USER = "owner";
    process.env.DASHBOARD_PASSWORD = "correct-horse";
    const request = new NextRequest("https://example.vercel.app/", {
      headers: {
        Authorization: `Basic ${Buffer.from("owner:correct-horse").toString("base64")}`,
      },
    });
    expect(proxy(request).status).toBe(200);
  });
});
