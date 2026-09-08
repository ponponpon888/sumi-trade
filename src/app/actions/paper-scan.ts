"use server";

import { headers } from "next/headers";

import { getDashboardAccess } from "@/lib/dashboard-auth";
import { recordPaperScan } from "@/lib/paper-journal";
import { getTradingDashboardData } from "@/lib/trading-engine";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown scan error";
}

export async function runManualPaperScan() {
  const authorization = (await headers()).get("authorization");
  if (getDashboardAccess(authorization) !== "allowed") {
    console.warn("[paper.scan.manual] authorization rejected");
    return {
      ok: false as const,
      executionLocked: true as const,
      message: "認証を確認できないため、紙上スキャンを実行できませんでした。",
    };
  }

  const startedAt = new Date().toISOString();
  console.info("[paper.scan.manual] started", { startedAt });

  try {
    const data = await getTradingDashboardData();
    const journal = await recordPaperScan(data);

    if (journal.status === "disabled" || journal.status === "error") {
      console.error("[paper.scan.manual] journal write failed", {
        startedAt,
        journalStatus: journal.status,
      });
      return {
        ok: false as const,
        executionLocked: true as const,
        message: journal.message,
      };
    }

    console.info("[paper.scan.manual] completed", {
      startedAt,
      lastScanAt: journal.lastScanAt,
      scanCount: journal.scanCount,
      journalStatus: journal.status,
      trendCandidateCount: data.trendScout.candidateCount,
      trendPaperCandidateCount: data.trendScout.paperCandidateCount,
      trendWarningCount: data.trendScout.warnings.length,
    });
    return {
      ok: true as const,
      executionLocked: true as const,
      message: "紙上スキャンを保存しました。実売買はロック中です。",
      lastScanAt: journal.lastScanAt,
      scanCount: journal.scanCount,
    };
  } catch (error) {
    console.error("[paper.scan.manual] failed", {
      startedAt,
      error: errorMessage(error),
    });
    return {
      ok: false as const,
      executionLocked: true as const,
      message: "紙上スキャンに失敗しました。Vercel Logsを確認してください。",
    };
  }
}
