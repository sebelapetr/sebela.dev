import { describe, expect, it } from "vitest";

import { diaryDateOf, elapsedSeconds, splitIntoDiaryDays, totalSeconds } from "./diary-time.js";

const at = (value: string) => new Date(value);

/** The pieces as comparable strings: date, start and end in UTC. */
function pieces(start: string, end: string) {
  return splitIntoDiaryDays(at(start), at(end)).map((piece) => ({
    date: piece.date,
    startedAt: piece.startedAt.toISOString(),
    endedAt: piece.endedAt.toISOString(),
  }));
}

describe("diaryDateOf", () => {
  it("groups by the Prague calendar day, not by the UTC day", () => {
    // 23:30 UTC on 2 March is 00:30 on 3 March in Prague (UTC+01:00); the old application's
    // UTC grouping put it on 2 March.
    expect(diaryDateOf(at("2026-03-02T23:30:00Z"))).toBe("2026-03-03");
    // 22:30 UTC on 1 July is 00:30 on 2 July in Prague (UTC+02:00).
    expect(diaryDateOf(at("2026-07-01T22:30:00Z"))).toBe("2026-07-02");
    expect(diaryDateOf(at("2026-03-02T22:59:59Z"))).toBe("2026-03-02");
  });

  it("does not depend on the process time zone", () => {
    const previous = process.env["TZ"];
    process.env["TZ"] = "America/Los_Angeles";
    try {
      expect(diaryDateOf(at("2026-03-02T23:30:00Z"))).toBe("2026-03-03");
    } finally {
      if (previous === undefined) delete process.env["TZ"];
      else process.env["TZ"] = previous;
    }
  });
});

describe("splitIntoDiaryDays", () => {
  it("keeps a session within one day whole", () => {
    expect(pieces("2026-03-02T08:00:00+01:00", "2026-03-02T09:15:00+01:00")).toEqual([
      {
        date: "2026-03-02",
        startedAt: "2026-03-02T07:00:00.000Z",
        endedAt: "2026-03-02T08:15:00.000Z",
      },
    ]);
  });

  it("splits 23:30 to 00:30 into 30 minutes on each day", () => {
    const split = splitIntoDiaryDays(
      at("2026-03-02T23:30:00+01:00"),
      at("2026-03-03T00:30:00+01:00"),
    );
    expect(split.map((piece) => piece.date)).toEqual(["2026-03-02", "2026-03-03"]);
    expect(split.map((piece) => elapsedSeconds(piece))).toEqual([1800, 1800]);
    expect(split[0]?.endedAt.toISOString()).toBe("2026-03-02T23:00:00.000Z");
    expect(split[1]?.startedAt.toISOString()).toBe("2026-03-02T23:00:00.000Z");
  });

  it("splits at every local midnight of a session over several days without losing time", () => {
    const start = at("2026-03-02T22:00:00+01:00");
    const end = at("2026-03-05T02:00:00+01:00");
    const split = splitIntoDiaryDays(start, end);
    expect(split.map((piece) => piece.date)).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
    ]);
    expect(totalSeconds(split)).toBe((end.getTime() - start.getTime()) / 1000);
  });

  it("does not split a session that ends exactly at midnight", () => {
    expect(pieces("2026-03-02T23:00:00+01:00", "2026-03-03T00:00:00+01:00")).toEqual([
      {
        date: "2026-03-02",
        startedAt: "2026-03-02T22:00:00.000Z",
        endedAt: "2026-03-02T23:00:00.000Z",
      },
    ]);
  });

  it("splits at the local midnight of summer time", () => {
    expect(pieces("2026-07-01T23:30:00+02:00", "2026-07-02T00:30:00+02:00")).toEqual([
      {
        date: "2026-07-01",
        startedAt: "2026-07-01T21:30:00.000Z",
        endedAt: "2026-07-01T22:00:00.000Z",
      },
      {
        date: "2026-07-02",
        startedAt: "2026-07-01T22:00:00.000Z",
        endedAt: "2026-07-01T22:30:00.000Z",
      },
    ]);
  });

  it("uses actual elapsed time across midnight on the spring and fall daylight-saving days", () => {
    // Prague moves from UTC+01:00 to UTC+02:00 at 02:00 on 29 March 2026: 23:00 to 04:00 local
    // is four hours, one before midnight and three after.
    const spring = splitIntoDiaryDays(
      at("2026-03-28T23:00:00+01:00"),
      at("2026-03-29T04:00:00+02:00"),
    );
    expect(spring.map((piece) => [piece.date, elapsedSeconds(piece)])).toEqual([
      ["2026-03-28", 3600],
      ["2026-03-29", 3 * 3600],
    ]);
    // Prague moves back to UTC+01:00 at 03:00 on 25 October 2026: 23:00 to 04:00 local is six
    // hours, one before midnight and five after.
    const fall = splitIntoDiaryDays(
      at("2026-10-24T23:00:00+02:00"),
      at("2026-10-25T04:00:00+01:00"),
    );
    expect(fall.map((piece) => [piece.date, elapsedSeconds(piece)])).toEqual([
      ["2026-10-24", 3600],
      ["2026-10-25", 5 * 3600],
    ]);
  });

  it("tells the repeated fall hour apart by its offset", () => {
    const first = splitIntoDiaryDays(
      at("2026-10-25T02:30:00+02:00"),
      at("2026-10-25T02:45:00+02:00"),
    );
    const second = splitIntoDiaryDays(
      at("2026-10-25T02:30:00+01:00"),
      at("2026-10-25T02:45:00+01:00"),
    );
    expect(first[0]?.date).toBe("2026-10-25");
    expect(second[0]?.date).toBe("2026-10-25");
    expect(first[0]?.startedAt.toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(second[0]?.startedAt.toISOString()).toBe("2026-10-25T01:30:00.000Z");
  });
});

describe("totalSeconds", () => {
  it("sums exact elapsed seconds and is zero for no entries", () => {
    const entries = [
      { startedAt: at("2026-03-02T08:00:00Z"), endedAt: at("2026-03-02T08:00:40Z") },
      { startedAt: at("2026-03-02T09:00:00Z"), endedAt: at("2026-03-02T09:00:50Z") },
    ];
    expect(entries.map(elapsedSeconds)).toEqual([40, 50]);
    expect(totalSeconds(entries)).toBe(90);
    expect(totalSeconds([])).toBe(0);
  });
});
