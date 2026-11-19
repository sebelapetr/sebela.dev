// The learning diary operations, private to the roadmap module and part of its service: notes per
// Prague calendar day, the time entries of what was studied or attended when, and the events shown
// on the days they cover. The database refuses an overlap and attendance outside an event's days
// atomically; this file decides days, splits, durations and how refusals read.
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
  TimeEntryTarget,
  TimeEntryWriteFailure,
} from "@sebela/db";

import { DomainError } from "../../errors.js";
import {
  diaryDateOf,
  elapsedSeconds,
  splitIntoDiaryDays,
  totalSeconds,
  type DiaryPiece,
} from "./diary-time.js";

/** The diary days a time-entry deletion changed. */
export interface TimeEntryDeletion {
  readonly dates: string[];
}

/**
 * The learning diary: one notes entry per Prague calendar day, the logged study sessions on
 * roadmap resources and attendance at events, and the events whose date range covers each day.
 * Durations and totals are derived from the stored endpoints on every read; an event's dates add
 * no time.
 */
export interface LearningDiary {
  /** Every diary day with notes, time entries or a covering event, newest first; may be empty. */
  getDiary(): Promise<Diary>;
  /** One diary day; a date without notes, time entries or a covering event is `not_found`. */
  getDiaryDay(date: string): Promise<DiaryDay>;
  /** One time entry as the diary shows it; `not_found` when missing. */
  getTimeEntry(id: string): Promise<TimeEntry>;
  /** Creates the day or replaces its notes; its time entries stay. */
  writeDiaryNotes(date: string, input: DiaryNotesWrite): Promise<DiaryDay>;
  /** Clears the day's notes and keeps its time entries; `not_found` when it has no notes. */
  deleteDiaryNotes(date: string): Promise<void>;
  /**
   * Logs a session on a resource or attendance at an event, split at each Prague midnight into
   * one entry per diary day, all or nothing. Refused with `validation_failed` for an unknown
   * resource or event, an end not after the start, a fraction of a second, or attendance on a day
   * outside the event (on `startedAt` when the start falls outside, otherwise on `endedAt`), and
   * with `conflict` when it overlaps any logged interval of either kind, also one written
   * concurrently. Adjacent intervals are allowed.
   */
  createTimeEntry(input: TimeEntryCreate): Promise<TimeEntryWrite>;
  /**
   * Changes the given fields of a time entry and splits the merged interval again; a given
   * `resource` or `event` moves it to that target, otherwise it keeps its own. The first piece
   * keeps the id, and the old and new days are returned with their notes untouched. The same
   * refusals as `createTimeEntry`, judged on the merged interval and target; `not_found` when
   * missing.
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

/** The target a write names, if any: an event or a resource, never both. */
function namedTarget(write: TimeEntryUpdate): TimeEntryTarget | undefined {
  if (write.event !== undefined) return { event: write.event };
  if (write.resource !== undefined) return { resource: write.resource };
  return undefined;
}

/** The target the entry is logged on now. */
function currentTarget(record: TimeEntryRecord): TimeEntryTarget {
  if (record.event !== null) return { event: record.event.slug };
  if (record.resource !== null) return { resource: record.resource.slug };
  throw new Error(`The time entry "${record.id}" has no target.`);
}

/**
 * Why a write of the session on the target was refused. Attendance outside the event is blamed on
 * the start when it falls outside the event's days, otherwise on the end that runs past them.
 */
function writeRefusal(
  failure: TimeEntryWriteFailure,
  target: TimeEntryTarget,
  startedAt: string,
): DomainError {
  const slug = "event" in target ? target.event : target.resource;
  switch (failure.reason) {
    case "unknown_resource":
      return invalid("resource", `There is no roadmap resource "${slug}"; create it first.`);
    case "unknown_event":
      return invalid("event", `There is no event "${slug}"; create it first.`);
    case "outside_event": {
      const date = diaryDateOf(new Date(startedAt));
      const path = date < failure.startsOn || date > failure.endsOn ? "startedAt" : "endedAt";
      return invalid(
        path,
        `Attendance must fall on the event's days, ${failure.startsOn} to ${failure.endsOn}.`,
      );
    }
    case "overlap":
      return new DomainError(
        "conflict",
        "The time overlaps an interval that is already logged; adjacent intervals are allowed.",
      );
  }
}

function toTimeEntry(record: TimeEntryRecord): TimeEntry {
  return {
    id: record.id,
    date: record.date,
    resource: record.resource === null ? null : { ...record.resource },
    event: record.event === null ? null : { ...record.event },
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
    events: record.events.map((event) => ({ ...event })),
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
    getTimeEntry: () => Promise.reject(new Error("Not implemented.")),
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
      const target = namedTarget(input);
      // The contract requires exactly one target; a body without one never reaches the service.
      if (target === undefined) throw invalid("resource", "Name a resource or an event.");
      const result = await persistence.createTimeEntries(target, pieces);
      if (!result.ok) throw writeRefusal(result, target, input.startedAt);
      return toWrite(result.entries);
    },
    async updateTimeEntry(id, changes) {
      // The merged session and target the plan judged, for reading a refusal of the database.
      let target: TimeEntryTarget = { resource: "" };
      let startedAt = "";
      const result = await persistence.replaceTimeEntry<SessionRefusal>(id, (current) => {
        target = namedTarget(changes) ?? currentTarget(current);
        startedAt = changes.startedAt ?? current.startedAt.toISOString();
        const pieces = planSession(startedAt, changes.endedAt ?? current.endedAt.toISOString());
        if (!Array.isArray(pieces)) return pieces;
        return { target, pieces };
      });
      if (result.ok) return toWrite(result.entries, result.previousDate);
      switch (result.reason) {
        case "not_found":
          throw noEntry(id);
        case "invalid_session":
          throw invalid(result.path, result.message);
        default:
          throw writeRefusal(result, target, startedAt);
      }
    },
    async deleteTimeEntry(id) {
      const result = await persistence.deleteTimeEntry(id);
      if (!result.ok) throw noEntry(id);
      return { dates: [result.date] };
    },
  };
}
