import { timingSafeEqual } from "node:crypto";

import { recordPaperScan } from "@/lib/paper-journal";
import { getTradingDashboardData } from "@/lib/trading-engine";

export const dynamic = "force-dynamic";

function isAuthorized(request: Request, secret: string): boolean {
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);

  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const schedule = request.headers.get("x-vercel-cron-schedule");

  if (!secret) {
    return Response.json(
      { ok: false, error: "Cron is disabled until CRON_SECRET is configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!isAuthorized(request, secret)) {
    return Response.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const startedAt = new Date().toISOString();
  console.info("[paper.scan.cron] started", { startedAt, schedule });

  try {
    const data = await getTradingDashboardData();
    const journal = await recordPaperScan(data);

    if (journal.status === "disabled" || journal.status === "error") {
      console.error("[paper.scan.cron] journal write failed", {
        startedAt,
        schedule,
        journalStatus: journal.status,
      });
      return Response.json(
        {
          ok: false,
          mode: "paper",
          executionLocked: true,
          error: journal.message,
          journal,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    console.info("[paper.scan.cron] completed", {
      startedAt,
      schedule,
      lastScanAt: journal.lastScanAt,
      scanCount: journal.scanCount,
      journalStatus: journal.status,
      trendCandidateCount: data.trendScout.candidateCount,
      trendPaperCandidateCount: data.trendScout.paperCandidateCount,
      trendWarningCount: data.trendScout.warnings.length,
    });

    return Response.json(
      {
        ok: true,
        mode: "paper",
        executionLocked: true,
        ...data,
        journal,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[paper.scan.cron] failed", {
      startedAt,
      schedule,
      error: error instanceof Error ? error.message : "Scan failed",
    });
    return Response.json(
      {
        ok: false,
        executionLocked: true,
        error: error instanceof Error ? error.message : "Scan failed",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
