import {
  emptySignalSelectionState,
  journalQualityRow,
  journalScanRow,
  JOURNAL_RAW_WINDOW_HOURS,
  pruneSignalSelectionState,
  retainedJournalRecords,
  selectIndependentSignalsFrom,
  settleableCandidate,
  settleCandidate,
  SETTLEMENT_DEADLINE_MS,
  type JournalInput,
  type JournalQualityRow,
  type JournalScanRow,
  type JournalStoredCandidate,
  type JournalStoredOutcome,
  type SettleableCandidate,
  type SignalSelectionState,
} from "@/lib/paper-journal-core";
import type { PaperScanRecord } from "@/lib/types";

const ONE_HOUR_MS = 60 * 60 * 1_000;

/** A selected signal still inside its settlement horizon. */
export type OpenCandidate = SettleableCandidate & { sequence: number };

/**
 * How far the one selection stream has advanced.
 *
 * The six-hour cooldown makes selection path dependent, so an incremental
 * caller cannot re-derive which signals were independent from the records it
 * can still see. The cooldown state travels here instead, together with the
 * signals that have been selected but not yet scored, which is what lets the
 * raw records be trimmed to the settlement horizon.
 */
export type JournalCursor = {
  schemaVersion: 1;
  /** Highest bucket whose signals have been offered to the selection. */
  processedThroughBucketMs: number;
  /** Next stream position to hand out. */
  nextSequence: number;
  selection: SignalSelectionState;
  open: OpenCandidate[];
  /** First scan ever observed; the readiness gate measures observation from it. */
  firstScan: JournalScanRow | null;
  /**
   * Latest source observation, kept even once it leaves the 24h window.
   *
   * Source freshness is reported from the newest observation of any age. With
   * only the 24h rows retained, an engine that has been down longer than that
   * would report no observation at all instead of a stale one.
   */
  lastQuality: JournalQualityRow | null;
};

export function emptyJournalCursor(): JournalCursor {
  return {
    schemaVersion: 1,
    processedThroughBucketMs: 0,
    nextSequence: 0,
    selection: emptySignalSelectionState(),
    open: [],
    firstScan: null,
    lastQuality: null,
  };
}

export function isJournalCursor(value: unknown): value is JournalCursor {
  if (!value || typeof value !== "object") return false;
  const cursor = value as Partial<JournalCursor>;
  return (
    cursor.schemaVersion === 1 &&
    typeof cursor.processedThroughBucketMs === "number" &&
    typeof cursor.nextSequence === "number" &&
    Array.isArray(cursor.open) &&
    typeof cursor.selection === "object" &&
    cursor.selection !== null &&
    typeof cursor.selection.lastSignalAt === "object" &&
    typeof cursor.selection.seenDecisionIds === "object"
  );
}

/** What one advance produced, for the caller to append to its day keys. */
export type JournalAdvance = {
  cursor: JournalCursor;
  scanRows: JournalScanRow[];
  qualityRows: JournalQualityRow[];
  candidates: JournalStoredCandidate[];
  outcomes: JournalStoredOutcome[];
};

/**
 * Carries the selection stream forward over records the cursor has not seen.
 *
 * Advancing over every record once, in order, is the same pass the full path
 * makes in one go — the cursor only exists so that pass can be interrupted.
 * The bucket is the unit of progress, so a second scan inside one bucket
 * replaces the record without being selected from again, the same way storage
 * treats the bucket as the idempotency key.
 */
export function advanceJournal(
  previous: JournalCursor | null,
  rawRecords: PaperScanRecord[],
  nowMs: number,
): JournalAdvance {
  const cursor = previous ?? emptyJournalCursor();
  const records = retainedJournalRecords(rawRecords, nowMs);
  const fresh = records.filter(
    (record) => record.bucketTimeMs > cursor.processedThroughBucketMs,
  );
  const { selected, state } = selectIndependentSignalsFrom(
    fresh,
    cursor.selection,
  );

  let nextSequence = cursor.nextSequence;
  const candidates: JournalStoredCandidate[] = [];
  const open: OpenCandidate[] = [...cursor.open];

  for (const candidate of selected) {
    const sequence = nextSequence;
    nextSequence += 1;
    candidates.push({
      sequence,
      entryBucketTimeMs: candidate.record.bucketTimeMs,
      model: candidate.signal.model ?? "chart",
      costGatePassed: candidate.signal.costGatePassed,
    });
    open.push({ sequence, ...settleableCandidate(candidate) });
  }

  const latestBucketMs =
    records.at(-1)?.bucketTimeMs ?? cursor.processedThroughBucketMs;
  const outcomes: JournalStoredOutcome[] = [];
  const stillOpen: OpenCandidate[] = [];

  for (const candidate of open.toSorted(
    (left, right) => left.sequence - right.sequence,
  )) {
    const outcome = settleCandidate(candidate, records);
    if (outcome) {
      outcomes.push({
        sequence: candidate.sequence,
        entryBucketTimeMs: candidate.entryBucketTimeMs,
        outcome,
      });
      continue;
    }
    /*
     * A signal whose horizon and grace period have both passed will never
     * settle. The full path leaves it a candidate with no outcome, which is
     * what dropping it here without emitting one does.
     */
    if (candidate.entryBucketTimeMs + SETTLEMENT_DEADLINE_MS > latestBucketMs) {
      stillOpen.push(candidate);
    }
  }

  const freshQuality = fresh.map(journalQualityRow);
  return {
    cursor: {
      schemaVersion: 1,
      processedThroughBucketMs: Math.max(
        cursor.processedThroughBucketMs,
        latestBucketMs,
      ),
      nextSequence,
      /*
       * Pruned to the raw window: the cooldown is shorter than it, and a
       * decision id is minted from its own bucket, so neither can be reached
       * by a record that is still to come.
       */
      selection: pruneSignalSelectionState(
        state,
        latestBucketMs - JOURNAL_RAW_WINDOW_HOURS * ONE_HOUR_MS,
      ),
      open: stillOpen,
      firstScan:
        cursor.firstScan ?? (fresh[0] ? journalScanRow(fresh[0]) : null),
      lastQuality: freshQuality.at(-1) ?? cursor.lastQuality,
    },
    scanRows: fresh.map(journalScanRow),
    qualityRows: freshQuality,
    candidates,
    outcomes,
  };
}

/** The derived rows a journal evaluation needs, however they were fetched. */
export type JournalStoreSlice = {
  cursor: JournalCursor | null;
  scanRows: JournalScanRow[];
  qualityRows: JournalQualityRow[];
  candidates: JournalStoredCandidate[];
  outcomes: JournalStoredOutcome[];
};

export function journalInputFromStore(slice: JournalStoreSlice): JournalInput {
  const qualityRows = slice.cursor?.lastQuality
    ? [...slice.qualityRows, slice.cursor.lastQuality]
    : slice.qualityRows;
  return {
    firstScan: slice.cursor?.firstScan ?? null,
    scanRows: slice.scanRows,
    qualityRows,
    candidates: slice.candidates,
    outcomes: slice.outcomes,
  };
}
