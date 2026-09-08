"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { runManualPaperScan } from "@/app/actions/paper-scan";
import {
  getPaperEngineHealth,
  type PaperEngineHealth,
} from "@/lib/paper-engine-health";
import type { PaperJournalStatus } from "@/lib/types";

const HEALTH_COPY: Record<
  PaperEngineHealth,
  { label: string; detail: string; dotClass: string }
> = {
  checking: {
    label: "PAPER ENGINE CHECKING",
    detail: "保存済みスキャンを確認中です。",
    dotClass: "is-checking",
  },
  live: {
    label: "PAPER ENGINE LIVE",
    detail: "5分Cronの保存記録を確認できています。",
    dotClass: "is-live",
  },
  waiting: {
    label: "WAITING FOR FIRST SCAN",
    detail: "最初の保存済みスキャンを待っています。",
    dotClass: "is-waiting",
  },
  stale: {
    label: "PAPER ENGINE STALE",
    detail: "12分以上、新しい保存記録がありません。Vercel Logsを確認してください。",
    dotClass: "is-stale",
  },
  error: {
    label: "PAPER ENGINE ERROR",
    detail: "検証記録ストレージを確認できません。",
    dotClass: "is-stale",
  },
};

function formatScanTime(lastScanAt: string | null): string {
  if (!lastScanAt) return "保存記録なし";
  const value = new Date(lastScanAt);
  if (!Number.isFinite(value.getTime())) return "時刻エラー";
  return `${new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(value)} JST`;
}

function formatAge(lastScanAt: string | null, nowMs: number): string {
  if (!lastScanAt || nowMs <= 0) return "";
  const lastScanMs = Date.parse(lastScanAt);
  if (!Number.isFinite(lastScanMs)) return "";
  const minutes = Math.max(0, Math.floor((nowMs - lastScanMs) / 60_000));
  return minutes === 0 ? "1分以内" : `${minutes}分前`;
}

export function PaperControls({
  observedAt,
  lastScanAt,
  scanCount,
  cadenceMinutes,
  journalStatus,
  journalMessage,
}: {
  observedAt: string;
  lastScanAt: string | null;
  scanCount: number;
  cadenceMinutes: number;
  journalStatus: PaperJournalStatus;
  journalMessage: string;
}) {
  const router = useRouter();
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.parse(observedAt) || 0);

  useEffect(() => {
    const clockId = window.setInterval(() => setNowMs(Date.now()), 30_000);
    const refreshId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      startRefreshTransition(() => router.refresh());
    }, 60_000);

    return () => {
      window.clearInterval(clockId);
      window.clearInterval(refreshId);
    };
  }, [router]);

  const health = getPaperEngineHealth({
    journalStatus,
    lastScanAt,
    nowMs,
    cadenceMinutes,
  });
  const copy = HEALTH_COPY[health];
  const lastScanAge = formatAge(lastScanAt, nowMs);
  const isAlert = health === "stale" || health === "error";

  async function scanNow() {
    setIsScanning(true);
    setScanMessage(null);
    try {
      const result = await runManualPaperScan();
      setScanMessage(result.message);
      setNowMs(Date.now());
      startRefreshTransition(() => router.refresh());
    } catch {
      setScanMessage("紙上スキャンを開始できませんでした。ページを再読込してください。");
    } finally {
      setIsScanning(false);
    }
  }

  return (
    <div className="control-panel" aria-label="ペーパートレード操作">
      <div className="control-copy">
        <span className={`status-dot ${copy.dotClass}`} />
        <div>
          <strong>{copy.label}</strong>
          <span>
            最終成功 {formatScanTime(lastScanAt)}
            {lastScanAge ? ` · ${lastScanAge}` : ""} · {scanCount}件
          </span>
        </div>
      </div>
      <div className="control-actions">
        <button
          className="button button-ghost"
          onClick={scanNow}
          disabled={isScanning || isRefreshing}
        >
          {isScanning ? "スキャン中…" : isRefreshing ? "更新中…" : "今すぐ紙上スキャン"}
        </button>
        <a
          className="execution-lock"
          href={journalStatus === "disabled" ? undefined : "/api/paper/export"}
          aria-disabled={journalStatus === "disabled"}
          style={{ justifyContent: "center", textDecoration: "none" }}
        >
          EXPORT 30D CSV · LOCKED
        </a>
      </div>
      <p className={`control-note ${isAlert ? "is-alert" : ""}`} aria-live="polite">
        {scanMessage ?? (isAlert ? journalMessage || copy.detail : copy.detail)}
        <br />
        画面は60秒ごとに自動更新。オンチェーン署名はコードレベルで無効です。
      </p>
    </div>
  );
}
