import { describe, expect, it } from "vitest";

import { eventDayOf, eventKindLabel, formatEventPeriod } from "./event-format";

describe("eventKindLabel", () => {
  it.each([
    ["conference", "Conference"],
    ["meetup", "Meetup"],
    ["workshop", "Workshop"],
    ["lecture", "Lecture"],
  ] as const)("names a %s as %s", (kind, label) => {
    expect(eventKindLabel(kind)).toBe(label);
  });
});

describe("formatEventPeriod", () => {
  it.each([
    ["2025-03-03", "2025-03-03", "March 3, 2025"],
    ["2025-02-26", "2025-02-28", "February 26–28, 2025"],
    ["2025-02-26", "2025-03-01", "February 26 – March 1, 2025"],
    ["2024-12-30", "2025-01-02", "December 30, 2024 – January 2, 2025"],
  ])("shows %s to %s as %s, never shifted by a time zone", (startsOn, endsOn, period) => {
    expect(formatEventPeriod(startsOn, endsOn)).toBe(period);
  });

  it("keeps a date it cannot read as it is", () => {
    expect(formatEventPeriod("someday", "someday")).toBe("someday");
    expect(formatEventPeriod("2025-03-03", "later")).toBe("2025-03-03 – later");
  });
});

describe("eventDayOf", () => {
  it("numbers a day of an event of several days", () => {
    expect(eventDayOf("2024-12-30", "2024-12-30", "2025-01-02")).toBe("Day 1 of 4");
    expect(eventDayOf("2025-01-01", "2024-12-30", "2025-01-02")).toBe("Day 3 of 4");
    expect(eventDayOf("2025-01-02", "2024-12-30", "2025-01-02")).toBe("Day 4 of 4");
  });

  it("counts calendar days across the night the clocks go back", () => {
    expect(eventDayOf("2025-10-27", "2025-10-25", "2025-10-27")).toBe("Day 3 of 3");
  });

  it("has no number for an event of one day or a day outside the event", () => {
    expect(eventDayOf("2025-03-03", "2025-03-03", "2025-03-03")).toBeNull();
    expect(eventDayOf("2025-03-05", "2025-03-03", "2025-03-04")).toBeNull();
    expect(eventDayOf("bad", "2025-03-03", "2025-03-04")).toBeNull();
  });
});
