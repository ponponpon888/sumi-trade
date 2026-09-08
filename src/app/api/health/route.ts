import { isPaperJournalConfigured } from "@/lib/paper-journal";

export function GET() {
  return Response.json(
    {
      ok: true,
      service: "sumi-trade-lab",
      mode: "paper",
      executionLocked: true,
      paperJournalConfigured: isPaperJournalConfigured(),
      dashboardAuthConfigured: Boolean(process.env.DASHBOARD_PASSWORD?.trim()),
      checkedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
