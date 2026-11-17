import { describe, expect, it } from "vitest";

import { formatDate, formatPeriod } from "./period";

describe("formatDate", () => {
  it.each([
    ["2023-10-01", "October 1st, 2023"],
    ["2023-10-02", "October 2nd, 2023"],
    ["2023-10-03", "October 3rd, 2023"],
    ["2023-10-04", "October 4th, 2023"],
    ["2023-10-11", "October 11th, 2023"],
    ["2023-10-12", "October 12th, 2023"],
    ["2023-10-13", "October 13th, 2023"],
    ["2023-10-21", "October 21st, 2023"],
    ["2023-10-22", "October 22nd, 2023"],
    ["2023-10-23", "October 23rd, 2023"],
    ["2023-10-24", "October 24th, 2023"],
    ["2023-10-30", "October 30th, 2023"],
    ["2023-10-31", "October 31st, 2023"],
  ])("writes %s with an ordinal day as %s", (isoDate, expected) => {
    expect(formatDate(isoDate)).toBe(expected);
  });

  it.each([
    ["2024-01-15", "January 15th, 2024"],
    ["2024-02-29", "February 29th, 2024"],
    ["2024-12-25", "December 25th, 2024"],
  ])("names every month in words: %s", (isoDate, expected) => {
    expect(formatDate(isoDate)).toBe(expected);
  });

  it("reads the calendar date as written, without a time-zone shift at the year's edges", () => {
    expect(formatDate("2022-01-01")).toBe("January 1st, 2022");
    expect(formatDate("2021-12-31")).toBe("December 31st, 2021");
  });
});

describe("formatPeriod", () => {
  it("joins the start and the end with an en dash", () => {
    expect(formatPeriod("2023-10-01", "2024-07-10")).toBe("October 1st, 2023 – July 10th, 2024");
  });

  it("ends an ongoing experience with present", () => {
    expect(formatPeriod("2022-08-05", null)).toBe("August 5th, 2022 – present");
  });

  it("shows one date for an experience that started and ended on the same day", () => {
    expect(formatPeriod("2024-03-03", "2024-03-03")).toBe("March 3rd, 2024");
  });

  it("writes concurrent experiences each with their own full period", () => {
    expect([
      formatPeriod("2022-04-01", null),
      formatPeriod("2020-06-01", null),
      formatPeriod("2021-02-12", "2023-11-23"),
    ]).toEqual([
      "April 1st, 2022 – present",
      "June 1st, 2020 – present",
      "February 12th, 2021 – November 23rd, 2023",
    ]);
  });
});
