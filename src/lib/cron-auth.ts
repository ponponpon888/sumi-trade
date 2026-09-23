import "server-only";

import { timingSafeEqual } from "node:crypto";

/** Constant-time check of Vercel Cron's `Authorization: Bearer <CRON_SECRET>`. */
export function isCronAuthorized(request: Request, secret: string): boolean {
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);

  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
