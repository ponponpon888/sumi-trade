import { recordBaseCostObservation } from "@/lib/base-cost-observation";
import { isCronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { ok: false, error: "Cron is disabled until CRON_SECRET is configured." },
      { status: 503, headers: NO_STORE },
    );
  }
  if (!isCronAuthorized(request, secret)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  try {
    const result = await recordBaseCostObservation();
    if (result.status === "storage-unavailable") {
      console.error("[base.cost.cron] storage unavailable");
      return Response.json(
        { ok: false, mode: "paper", executionLocked: true, error: "STORAGE_UNAVAILABLE" },
        { status: 503, headers: NO_STORE },
      );
    }
    console.info("[base.cost.cron] completed", {
      status: result.status,
      observation: result.status === "recorded" ? result.record.status : null,
    });
    return Response.json(
      { ok: true, mode: "paper", executionLocked: true, ...result },
      { headers: NO_STORE },
    );
  } catch {
    // Redis or unexpected failures: no raw error text, URLs or credentials.
    console.error("[base.cost.cron] failed");
    return Response.json(
      { ok: false, mode: "paper", executionLocked: true, error: "BASE_COST_OBSERVATION_FAILED" },
      { status: 503, headers: NO_STORE },
    );
  }
}
