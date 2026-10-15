import { describe, expect, it } from "vitest";

import {
  buildJournalInputFromRecords,
  evaluateJournalInput,
  evaluatePaperJournal,
  JOURNAL_RAW_WINDOW_HOURS,
  selectIndependentSignals,
  type JournalQualityRow,
  type JournalScanRow,
  type JournalStoredCandidate,
  type JournalStoredOutcome,
} from "@/lib/paper-journal-core";
import {
  advanceJournal,
  journalInputFromStore,
  type JournalCursor,
} from "@/lib/paper-journal-derived";
import type {
  DataSourceId,
  PaperDataSourceObservation,
  PaperScanRecord,
} from "@/lib/types";

const WALLET = "0x0000000000000000000000000000000000000001";
const ONE_HOUR_MS = 60 * 60 * 1_000;
const HALF_HOUR_MS = 30 * 60 * 1_000;
const RAW_WINDOW_MS = JOURNAL_RAW_WINDOW_HOURS * ONE_HOUR_MS;
const SOURCES: DataSourceId[] = [
  "blockscout",
  "dexscreener",
  "geckoterminal",
  "ethereum-rpc",
  "kyberswap",
];

function observations(impaired: boolean): PaperDataSourceObservation[] {
  return SOURCES.map((source) => ({
    source,
    status: impaired && source === "geckoterminal" ? "unavailable" : "healthy",
    coveragePercent: impaired && source === "geckoterminal" ? 0 : 100,
    dataAgeSeconds: 30,
    qualityDefinition: 2,
    requestedCount: 1,
    sourceUnavailableCount: impaired && source === "geckoterminal" ? 1 : 0,
    sourceStaleCount: 0,
    policyBlockedCount: 0,
    failureBreakdown: {
      rateLimited: 0,
      timeout: impaired && source === "geckoterminal" ? 1 : 0,
      httpError: 0,
      parseError: 0,
      other: 0,
    },
  }));
}

function scan(
  bucketTimeMs: number,
  price: number,
  options: { signal?: boolean; impaired?: boolean } = {},
): PaperScanRecord {
  const id = new Date(bucketTimeMs).toISOString().replace(/[:.]/g, "-");
  return {
    schemaVersion: 1,
    id,
    bucketTimeMs,
    generatedAt: new Date(bucketTimeMs + 1_000).toISOString(),
    walletAddress: WALLET,
    portfolioValueUsd: 1_000,
    executionLocked: true,
    prices: { TEST: price },
    signals: options.signal
      ? [
          {
            decisionId: `${id}:chart:TEST:BUY`,
            model: "chart",
            priceKey: "TEST",
            symbol: "TEST",
            direction: "BUY",
            entryPriceUsd: price,
            modelScore: 70,
            confidence: 70,
            marketRegime: "uptrend",
            decisionReasons: ["EMA alignment"],
            notionalUsd: 200,
            estimatedCostUsd: 2,
            costGatePassed: true,
            buyGate: "passed",
            stopLossPercent: 4,
            takeProfitPercent: 8,
            trailingStopPercent: 3,
          },
        ]
      : [],
    dataSourceQuality: observations(options.impaired ?? false),
  };
}

/**
 * Nine days of half-hourly scans, every one of them carrying a BUY.
 *
 * A signal every 30 minutes against a six-hour cooldown means most of them are
 * suppressed, and which ones survive depends on which survived before — the
 * path dependence the cursor has to reproduce. The price walk makes the
 * survivors alternate between wins and losses so the streak and drift figures
 * have something to disagree about.
 */
const START_MS = Date.UTC(2026, 8, 1, 0, 0, 0);
const SCAN_COUNT = 9 * 24 * 2;
const NOW_MS = START_MS + (SCAN_COUNT - 1) * HALF_HOUR_MS + 60_000;

function series(): PaperScanRecord[] {
  return Array.from({ length: SCAN_COUNT }, (_, index) => {
    const bucketTimeMs = START_MS + index * HALF_HOUR_MS;
    const price = 100 + 8 * Math.sin(index / 5) + (index % 7);
    return scan(bucketTimeMs, Number(price.toFixed(4)), {
      signal: true,
      impaired: index % 23 === 0,
    });
  });
}

type Store = {
  cursor: JournalCursor | null;
  scanRows: JournalScanRow[];
  qualityRows: JournalQualityRow[];
  candidates: JournalStoredCandidate[];
  outcomes: JournalStoredOutcome[];
};

/**
 * Replays the records the way production does: one scan at a time, with only
 * the raw window visible and everything else carried in the cursor.
 */
function replayIncrementally(records: PaperScanRecord[]): Store {
  const store: Store = {
    cursor: null,
    scanRows: [],
    qualityRows: [],
    candidates: [],
    outcomes: [],
  };

  for (const [index, record] of records.entries()) {
    const nowMs = record.bucketTimeMs + 1_000;
    const rawWindow = records
      .slice(0, index + 1)
      .filter((item) => item.bucketTimeMs >= nowMs - RAW_WINDOW_MS);
    const advance = advanceJournal(store.cursor, rawWindow, nowMs);
    store.cursor = advance.cursor;
    store.scanRows.push(...advance.scanRows);
    store.qualityRows.push(...advance.qualityRows);
    store.candidates.push(...advance.candidates);
    store.outcomes.push(...advance.outcomes);
  }

  return store;
}

function storeInput(store: Store) {
  return journalInputFromStore({
    cursor: store.cursor,
    scanRows: store.scanRows,
    qualityRows: store.qualityRows,
    candidates: store.candidates,
    outcomes: store.outcomes,
  });
}

describe("incremental journal equivalence", () => {
  const records = series();
  const store = replayIncrementally(records);
  const reference = buildJournalInputFromRecords(records, NOW_MS);

  /**
   * The signal set itself, not only the figures computed from it. The cooldown
   * is path dependent, so two streams can agree on a metric while disagreeing
   * about which signals they measured.
   */
  it("selects the same signals as a full replay", () => {
    expect(store.candidates).toEqual(reference.candidates);
    expect(store.candidates.length).toBeGreaterThan(20);
  });

  it("selects the same signals the one-pass selection does", () => {
    const onePass = selectIndependentSignals(records).map((candidate) => ({
      entryBucketTimeMs: candidate.record.bucketTimeMs,
      decisionId: candidate.signal.decisionId,
    }));
    const incremental = store.candidates.map((candidate) => ({
      entryBucketTimeMs: candidate.entryBucketTimeMs,
      decisionId: `${new Date(candidate.entryBucketTimeMs)
        .toISOString()
        .replace(/[:.]/g, "-")}:chart:TEST:BUY`,
    }));
    expect(incremental).toEqual(onePass);
  });

  it("scores the same outcomes as a full replay", () => {
    expect(store.outcomes).toEqual(reference.outcomes);
    expect(store.outcomes.length).toBeGreaterThan(20);
  });

  it("produces the same journal snapshot as a full replay", () => {
    expect(evaluateJournalInput(storeInput(store), NOW_MS)).toEqual(
      evaluatePaperJournal(records, NOW_MS),
    );
  });

  it("agrees on the figures the safety gates read", () => {
    const incremental = evaluateJournalInput(storeInput(store), NOW_MS);
    const full = evaluatePaperJournal(records, NOW_MS);
    expect(incremental.driftPerformanceByModel).toEqual(
      full.driftPerformanceByModel,
    );
    expect(incremental.currentLossStreak).toBe(full.currentLossStreak);
    expect(incremental.dailyLossPercent).toBe(full.dailyLossPercent);
    expect(incremental.status).toBe(full.status);
    expect(incremental.operationalReadiness).toEqual(full.operationalReadiness);
  });

  /**
   * Keeps the assertions above honest. If seeding a fresh cooldown halfway
   * through picked the same signals, the equivalence tests would pass without
   * the cursor carrying anything.
   */
  it("suppresses a signal only because the cooldown state was carried", () => {
    const entry = scan(START_MS, 100, { signal: true });
    const next = scan(START_MS + HALF_HOUR_MS, 100, { signal: true });
    const nextNow = START_MS + HALF_HOUR_MS + 60_000;
    const opened = advanceJournal(null, [entry], START_MS + 60_000);
    expect(opened.candidates).toHaveLength(1);

    const carried = advanceJournal(opened.cursor, [entry, next], nextNow);
    const reset = advanceJournal(
      { ...opened.cursor, selection: { lastSignalAt: {}, seenDecisionIds: {} } },
      [entry, next],
      nextNow,
    );
    expect(carried.candidates).toHaveLength(0);
    expect(reset.candidates).toHaveLength(1);
  });
});

/**
 * Which timestamp the drift windows cut on, asserted rather than assumed.
 *
 * Both the current and the twelve-hour confirmation anchor compare
 * `outcomeTime`, so a signal entered before an edge but scored after it counts
 * as recent. The derived store files outcomes under the UTC date of the same
 * timestamp, which is what keeps a day-key range read and these windows
 * cutting at the same place.
 */
describe("drift window boundaries", () => {
  const nowMs = Date.UTC(2026, 8, 30, 12);
  const recentEdgeMs = nowMs - 7 * 24 * ONE_HOUR_MS;

  function storedOutcome(
    sequence: number,
    entryMs: number,
    outcomeMs: number,
    netPnlUsd: number,
  ) {
    return {
      sequence,
      entryBucketTimeMs: entryMs,
      outcome: {
        decisionId: `drift-${sequence}`,
        model: "chart" as const,
        priceKey: "TEST",
        symbol: "TEST",
        direction: "BUY" as const,
        entryPriceUsd: 100,
        modelScore: 70,
        confidence: 70,
        notionalUsd: 200,
        estimatedCostUsd: 2,
        costGatePassed: true,
        signalTime: new Date(entryMs).toISOString(),
        outcomeTime: new Date(outcomeMs).toISOString(),
        exitPriceUsd: 100 + netPnlUsd,
        grossReturnPercent: netPnlUsd,
        netReturnPercent: netPnlUsd,
        netPnlUsd,
        won: netPnlUsd > 0,
      },
    };
  }

  it("counts a signal entered before the edge but scored after it as recent", () => {
    const straddling = storedOutcome(
      0,
      recentEdgeMs - 2 * ONE_HOUR_MS,
      recentEdgeMs + ONE_HOUR_MS,
      5,
    );
    const baseline = storedOutcome(
      1,
      recentEdgeMs - 3 * 24 * ONE_HOUR_MS,
      recentEdgeMs - 3 * 24 * ONE_HOUR_MS + 6 * ONE_HOUR_MS,
      -4,
    );
    const snapshot = evaluateJournalInput(
      {
        firstScan: {
          bucketTimeMs: nowMs - 29 * 24 * ONE_HOUR_MS,
          generatedAt: new Date(nowMs - 29 * 24 * ONE_HOUR_MS).toISOString(),
          portfolioValueUsd: 1_000,
        },
        scanRows: [],
        qualityRows: [],
        candidates: [],
        outcomes: [straddling, baseline],
      },
      nowMs,
    );

    expect(snapshot.driftPerformanceByModel.chart.recent.maturedCount).toBe(1);
    expect(snapshot.driftPerformanceByModel.chart.recent.netPnlUsd).toBe(5);
    expect(snapshot.driftPerformanceByModel.chart.baseline.maturedCount).toBe(1);
    expect(snapshot.driftPerformanceByModel.chart.baseline.netPnlUsd).toBe(-4);
  });

  /**
   * The outcome sits in the part of its UTC day that a thirty-day window
   * starting at midday still reaches. It is only reported if the store asked
   * for that boundary day's key rather than the whole days after it.
   */
  it("keeps an outcome scored in the window's own boundary day", () => {
    const analyticsEdgeMs = nowMs - 30 * 24 * ONE_HOUR_MS;
    const inBoundaryDay = storedOutcome(
      0,
      analyticsEdgeMs,
      analyticsEdgeMs + 6 * ONE_HOUR_MS,
      7,
    );
    const snapshot = evaluateJournalInput(
      {
        firstScan: null,
        scanRows: [],
        qualityRows: [],
        candidates: [],
        outcomes: [inBoundaryDay],
      },
      nowMs,
    );

    const dropped = evaluateJournalInput(
      {
        firstScan: null,
        scanRows: [],
        qualityRows: [],
        candidates: [],
        outcomes: [storedOutcome(0, analyticsEdgeMs, analyticsEdgeMs - 1, 7)],
      },
      nowMs,
    );

    expect(new Date(analyticsEdgeMs).toISOString().slice(0, 10)).toBe(
      "2026-08-31",
    );
    expect(snapshot.driftPerformanceByModel.chart.baseline.maturedCount).toBe(1);
    expect(dropped.driftPerformanceByModel.chart.baseline.maturedCount).toBe(0);
  });
});

describe("incremental journal bookkeeping", () => {
  it("does not select twice from a bucket that was scanned again", () => {
    const first = scan(START_MS, 100, { signal: true });
    const rescan = { ...first, prices: { TEST: 101 } };
    const nowMs = START_MS + 60_000;
    const once = advanceJournal(null, [first], nowMs);
    const twice = advanceJournal(once.cursor, [rescan], nowMs);
    expect(once.candidates).toHaveLength(1);
    expect(twice.candidates).toHaveLength(0);
  });

  it("keeps a signal open until its horizon, then stops carrying it", () => {
    const entry = scan(START_MS, 100, { signal: true });
    const opened = advanceJournal(null, [entry], START_MS + 60_000);
    expect(opened.cursor.open).toHaveLength(1);
    expect(opened.outcomes).toHaveLength(0);

    const horizon = scan(START_MS + 6 * ONE_HOUR_MS, 110);
    const settledNow = START_MS + 6 * ONE_HOUR_MS + 60_000;
    const settled = advanceJournal(
      opened.cursor,
      [entry, horizon],
      settledNow,
    );
    expect(settled.outcomes).toHaveLength(1);
    expect(settled.outcomes[0].outcome.netReturnPercent).toBe(9);
    expect(settled.cursor.open).toHaveLength(0);
  });

  it("stops carrying a signal no price ever reached", () => {
    const entry = scan(START_MS, 100, { signal: true });
    const opened = advanceJournal(null, [entry], START_MS + 60_000);
    const lateNow = START_MS + 8 * ONE_HOUR_MS;
    const late = advanceJournal(
      opened.cursor,
      [entry, scan(lateNow, 110)],
      lateNow + 60_000,
    );
    expect(late.outcomes).toHaveLength(0);
    expect(late.cursor.open).toHaveLength(0);
  });

  it("bounds the cooldown state it carries to the raw window", () => {
    const entry = scan(START_MS, 100, { signal: true });
    const opened = advanceJournal(null, [entry], START_MS + 60_000);
    expect(Object.keys(opened.cursor.selection.lastSignalAt)).toHaveLength(1);

    const muchLater = START_MS + 20 * ONE_HOUR_MS;
    const advanced = advanceJournal(
      opened.cursor,
      [scan(muchLater, 100)],
      muchLater + 60_000,
    );
    expect(advanced.cursor.selection.lastSignalAt).toEqual({});
    expect(advanced.cursor.selection.seenDecisionIds).toEqual({});
  });

  it("remembers the first scan and the newest source observation", () => {
    const first = scan(START_MS, 100, { signal: true });
    const opened = advanceJournal(null, [first], START_MS + 60_000);
    const laterMs = START_MS + 30 * ONE_HOUR_MS;
    const later = advanceJournal(
      opened.cursor,
      [scan(laterMs, 100, { impaired: true })],
      laterMs + 60_000,
    );
    expect(later.cursor.firstScan?.bucketTimeMs).toBe(START_MS);
    expect(later.cursor.lastQuality?.bucketTimeMs).toBe(laterMs);
  });
});
