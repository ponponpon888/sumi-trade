import { timingSafeEqual } from "node:crypto";

export type DashboardAccess = "allowed" | "locked" | "unauthorized";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function suppliedCredentials(authorization: string | null): {
  username: string;
  password: string;
} | null {
  if (!authorization?.startsWith("Basic ")) return null;

  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString(
      "utf8",
    );
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

export function getDashboardAccess(
  authorization: string | null,
): DashboardAccess {
  if (process.env.VERCEL !== "1") return "allowed";

  const expectedPassword = process.env.DASHBOARD_PASSWORD?.trim();
  if (!expectedPassword) return "locked";

  const expectedUsername = process.env.DASHBOARD_USER?.trim() || "sumi";
  const supplied = suppliedCredentials(authorization);
  if (
    supplied &&
    safeEqual(supplied.username, expectedUsername) &&
    safeEqual(supplied.password, expectedPassword)
  ) {
    return "allowed";
  }

  return "unauthorized";
}
