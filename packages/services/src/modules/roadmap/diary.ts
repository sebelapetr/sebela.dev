// The learning diary operations, private to the roadmap module and part of its service: notes per
// Prague calendar day and the time entries of what was studied when. The database refuses an
// overlap atomically; this file decides days, splits, durations and how refusals read.
import type {
  Diary,
  DiaryDay,
  DiaryNotesWrite,
  TimeEntry,
  TimeEntryCreate,
  TimeEntryUpdate,
  TimeEntryWrite,
} from "@sebela/contracts";
import type {
  DiaryDayRecord,
  RoadmapPersistence,
  TimeEntryRecord,
  TimeEntryWriteFailure,
} from "@sebela/db";

import { DomainError } from "../../errors.js";
import { elapsedSeconds, splitIntoDiaryDays, totalSeconds, type DiaryPiece } from "./diary-time.js";

/** The diary days a time-entry deletion changed. */
export interface TimeEntryDeletion {
  readonly dates: string[];
}

/**
 * The learning diary: one notes entry per Prague calendar day and the logged study sessions on
 * roadmap resources. Durations and totals are derived from the stored endpoints on every read.
 */
export interface LearningDiary {
  /** Every diary day with notes or time entries, newest first; may be empty. */
  getDiary(): Promise<Diary>;
  /** One diary day; a date without notes or time entries is `not_found`. */
  getDiaryDay(date: string): Promise<DiaryDay>;
  /** Creates the day or replaces its notes; its time entries stay. */
  writeDiaryNotes(date: string, input: DiaryNotesWrite): Promise<DiaryDay>;
  /** Clears the day's notes and keeps its time entries; `not_found` when it has no notes. */
  deleteDiaryNotes(date: string): Promise<void>;
  /**
   * Logs a session on a resource, split at each Prague midnight into one entry per diary day, all
   * or nothing. Refused with `validation_failed` for an unknown resource, an end not after the
   * start or a fraction of a second, and with `conflict` when it overlaps any logged interval,
   * also one written concurrently. Adjacent intervals are allowed.
   */
  createTimeEntry(input: TimeEntryCreate): Promise<TimeEntryWrite>;
  /**
   * Changes the given fields of a time entry and splits the merged interval again; the first
   * piece keeps the id, and the old and new days are returned with their notes untouched. The
   * same refusals as `createTimeEntry`, judged on the merged interval; `not_found` when missing.
   */
  updateTimeEntry(id: string, changes: TimeEntryUpdate): Promise<TimeEntryWrite>;
  /** Deletes the time entry and returns its day; its notes stay. `not_found` when missing. */
  deleteTimeEntry(id: string): Promise<TimeEntryDeletion>;
}

const ORDER_RULE = "The end must be after the start.";
const WHOLE_SECONDS = "Give the time in whole seconds.";

const invalid = (path: string, message: string) =>
  new DomainError("validation_failed", message, [{ path, message }]);
const noDay = (date: string) => new DomainError("not_found", `The diary has nothing on ${date}.`);
const noEntry = (id: string) => new DomainError("not_found", `There is no time entry "${id}".`);

/** Why a session cannot be split into diary pieces, as a plan refusal. */
interface SessionRefusal {
  ok: false;
  reason: "invalid_session";
  path: string;
  message: string;
}

/** The diary pieces of the session, or why it is refused. */
function planSession(startedAt: string, endedAt: string): DiaryPiece[] | SessionRefusal {
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  for (const [path, instant] of [
    ["startedAt", start],
    ["endedAt", end],
  ] as const) {
    if (instant.getTime() % 1000 !== 0) {
      return { ok: false, reason: "invalid_session", path, message: WHOLE_SECONDS };
    }
  }
  if (end <= start) {
    return { ok: false, reason: "invalid_session", path: "endedAt", message: ORDER_RULE };
  }
  return splitIntoDiaryDays(start, end);
}

function writeRefusal(failure: TimeEntryWriteFailure, resource: string): DomainError {
  if (failure.reason === "unknown_resource") {
    return invalid("resource", `There is no roadmap resource "${resource}"; create it first.`);
  }
  return new DomainError(
    "conflict",
    "The time overlaps an interval that is already logged; adjacent intervals are allowed.",
  );
}

function toTimeEntry(record: TimeEntryRecord): TimeEntry {
  return {
    id: record.id,
    date: record.date,
    resource: { ...record.resource },
    startedAt: record.startedAt.toISOString(),
    endedAt: record.endedAt.toISOString(),
    durationSeconds: elapsedSeconds(record),
  };
}

function toDiaryDay(record: DiaryDayRecord): DiaryDay {
  return {
    date: record.date,
    notes: record.notes,
    entries: record.entries.map(toTimeEntry),
    totalSeconds: totalSeconds(record.entries),
  };
}

/** The written entries and every changed day, ascending and each once. */
function toWrite(entries: readonly TimeEntryRecord[], ...previous: string[]): TimeEntryWrite {
  const dates = new Set([...previous, ...entries.map((entry) => entry.date)]);
  return { entries: entries.map(toTimeEntry), dates: [...dates].sort() };
}

/** The diary operations over the roadmap persistence. */
export function createLearningDiary(persistence: RoadmapPersistence): LearningDiary {
  return {
    async getDiary() {
      return { days: (await persistence.loadDiary()).map(toDiaryDay) };
    },
    async getDiaryDay(date) {
      const day = await persistence.findDiaryDay(date);
      if (!day) throw noDay(date);
      return toDiaryDay(day);
    },
    async writeDiaryNotes(date, input) {
      return toDiaryDay(await persistence.writeDiaryNotes(date, input.notes));
    },
    async deleteDiaryNotes(date) {
      const result = await persistence.clearDiaryNotes(date);
      if (!result.ok) throw new DomainError("not_found", `The diary has no notes on ${date}.`);
    },

    async createTimeEntry(input) {
      const pieces = planSession(input.startedAt, input.endedAt);
      if (!Array.isArray(pieces)) throw invalid(pieces.path, pieces.message);
      const result = await persistence.createTimeEntries(input.resource, pieces);
      if (!result.ok) throw writeRefusal(result, input.resource);
      return toWrite(result.entries);
    },
    async updateTimeEntry(id, changes) {
      const result = await persistence.replaceTimeEntry<SessionRefusal>(id, (current) => {
        const pieces = planSession(
          changes.startedAt ?? current.startedAt.toISOString(),
          changes.endedAt ?? current.endedAt.toISOString(),
        );
        if (!Array.isArray(pieces)) return pieces;
        return { resource: changes.resource ?? current.resource.slug, pieces };
      });
      if (result.ok) return toWrite(result.entries, result.previousDate);
      switch (result.reason) {
        case "not_found":
          throw noEntry(id);
        case "invalid_session":
          throw invalid(result.path, result.message);
        default:
          throw writeRefusal(result, changes.resource ?? "");
      }
    },
    async deleteTimeEntry(id) {
      const result = await persistence.deleteTimeEntry(id);
      if (!result.ok) throw noEntry(id);
      return { dates: [result.date] };
    },
  };
}
