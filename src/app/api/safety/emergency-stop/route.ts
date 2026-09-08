import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  getSafetyControlSnapshot,
  setPersistentEmergencyStop,
} from "@/lib/safety-control";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().min(3).max(160),
});

function isAuthorized(request: Request, secret: string): boolean {
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function authorize(request: Request): Response | null {
  const secret = process.env.SAFETY_CONTROL_SECRET?.trim();
  if (!secret || secret.length < 16) {
    return Response.json(
      { ok: false, error: "Safety control is locked until a strong secret is configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!isAuthorized(request, secret)) {
    return Response.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return null;
}

export async function GET(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  return Response.json(
    { ok: true, safety: await getSafetyControlSnapshot() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;

  try {
    const input = requestSchema.parse(await request.json());
    await setPersistentEmergencyStop(input.enabled, input.reason);
    const safety = await getSafetyControlSnapshot();
    return Response.json(
      { ok: true, safety },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { ok: false, error: "Invalid safety control request." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      { ok: false, error: "Persistent safety control is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
