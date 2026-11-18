import { describe, expect, it } from "vitest";

import {
  DiaryDateParamsSchema,
  DiaryDaySchema,
  DiaryNotesWriteSchema,
  DiarySchema,
  TimeEntryCreateSchema,
  TimeEntryIdParamsSchema,
  TimeEntryUpdateSchema,
  TimeEntryWriteSchema,
  diaryTimeZone,
} from "./index.js";

const session = {
  resource: "prompting-notes",
  startedAt: "2026-03-02T23:30:00+01:00",
  endedAt: "2026-03-03T00:30:00+01:00",
};

const entry = {
  id: "0b7a9a51-3c2e-4f1a-8d6b-2e4c6a8b0d1f",
  date: "2026-03-02",
  resource: {
    slug: "prompting-notes",
    name: "Prompting notes",
    type: "text",
    link: "https://example.com/prompting-notes",
    module: "prompting-basics",
    area: "foundations",
  },
  startedAt: "2026-03-02T22:30:00.000Z",
  endedAt: "2026-03-02T23:00:00.000Z",
  durationSeconds: 1800,
};

const day = { date: "2026-03-02", notes: "Read about **fictional** prompts.", entries: [entry] };

describe("the diary time zone", () => {
  it("is Europe/Prague", () => {
    expect(diaryTimeZone).toBe("Europe/Prague");
  });
});

describe("DiaryDateParamsSchema", () => {
  it("accepts a calendar date", () => {
    expect(DiaryDateParamsSchema.parse({ date: "2026-02-28" })).toEqual({ date: "2026-02-28" });
  });

  it.each(["2026-02-30", "2026-2-1", "20260201", "2026-02-01T00:00:00Z", "today"])(
    "refuses %s",
    (date) => {
      const result = DiaryDateParamsSchema.safeParse({ date });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(["date"]);
    },
  );
});

describe("TimeEntryIdParamsSchema", () => {
  it("accepts a UUID and refuses anything else", () => {
    expect(TimeEntryIdParamsSchema.parse({ id: entry.id })).toEqual({ id: entry.id });
    expect(TimeEntryIdParamsSchema.safeParse({ id: "first" }).success).toBe(false);
  });
});

describe("TimeEntryCreateSchema", () => {
  it("accepts a session with offsets and with UTC instants", () => {
    expect(TimeEntryCreateSchema.parse(session)).toEqual(session);
    const utc = { ...session, startedAt: "2026-03-02T22:30:00Z", endedAt: "2026-03-02T23:30:00Z" };
    expect(TimeEntryCreateSchema.parse(utc)).toEqual(utc);
  });

  it("refuses a local time without an offset, which a daylight-saving change makes ambiguous", () => {
    const result = TimeEntryCreateSchema.safeParse({
      ...session,
      startedAt: "2026-10-25T02:30:00",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["startedAt"]);
  });

  it("does not compare the end with a start it already refused", () => {
    // Read as a local time of the process, the start could fall either side of the end.
    const result = TimeEntryCreateSchema.safeParse({
      ...session,
      startedAt: "2026-03-03T00:30:00",
      endedAt: "2026-03-02T23:30:00Z",
    });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["startedAt"]]);
    const update = TimeEntryUpdateSchema.safeParse({
      startedAt: session.startedAt,
      endedAt: "2026-03-02",
    });
    expect(update.error?.issues.map((issue) => issue.path)).toEqual([["endedAt"]]);
  });

  it.each([
    ["equal to", "2026-03-02T23:30:00+01:00"],
    ["before", "2026-03-02T22:30:00Z"],
  ])("refuses an end %s the start, compared as instants", (_, endedAt) => {
    const result = TimeEntryCreateSchema.safeParse({ ...session, endedAt });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["endedAt"]);
  });

  it("refuses a missing resource and an unknown field", () => {
    const withoutResource = { startedAt: session.startedAt, endedAt: session.endedAt };
    expect(TimeEntryCreateSchema.safeParse(withoutResource).success).toBe(false);
    expect(TimeEntryCreateSchema.safeParse({ ...session, minutes: 60 }).success).toBe(false);
  });
});

describe("TimeEntryUpdateSchema", () => {
  it("accepts any one field and refuses an empty change", () => {
    expect(TimeEntryUpdateSchema.parse({ resource: "intro-video" })).toEqual({
      resource: "intro-video",
    });
    expect(TimeEntryUpdateSchema.parse({ endedAt: session.endedAt })).toEqual({
      endedAt: session.endedAt,
    });
    expect(TimeEntryUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("refuses an end not after the start when both are sent", () => {
    const result = TimeEntryUpdateSchema.safeParse({
      startedAt: session.endedAt,
      endedAt: session.startedAt,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["endedAt"]);
  });
});

describe("DiaryNotesWriteSchema", () => {
  it("accepts trimmed Markdown notes and refuses empty notes or an unknown field", () => {
    expect(DiaryNotesWriteSchema.parse({ notes: "  Some *notes*. " })).toEqual({
      notes: "Some *notes*.",
    });
    expect(DiaryNotesWriteSchema.safeParse({ notes: " " }).success).toBe(false);
    expect(DiaryNotesWriteSchema.safeParse({ notes: "x", date: "2026-03-02" }).success).toBe(false);
  });
});

describe("the diary reads", () => {
  it("describes a day with its notes, its entries and their total", () => {
    const parsed = DiaryDaySchema.parse({ ...day, totalSeconds: 1800 });
    expect(parsed.entries[0]?.resource.area).toBe("foundations");
  });

  it("describes a notes-only day and the diary newest first", () => {
    const notesOnly = { date: "2026-03-01", notes: "Planning.", entries: [], totalSeconds: 0 };
    expect(
      DiarySchema.parse({ days: [{ ...day, totalSeconds: 1800 }, notesOnly] }).days,
    ).toHaveLength(2);
    expect(DiarySchema.parse({ days: [] })).toEqual({ days: [] });
  });

  it("describes a write with every affected day", () => {
    expect(
      TimeEntryWriteSchema.parse({ entries: [entry], dates: ["2026-03-02", "2026-03-03"] }),
    ).toMatchObject({ dates: ["2026-03-02", "2026-03-03"] });
  });
});
