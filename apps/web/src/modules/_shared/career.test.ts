import { describe, expect, it } from "vitest";

import { careerYears } from "./career";

describe("careerYears", () => {
  it("counts whole years since the career started", () => {
    expect(careerYears("2015-09-01", new Date("2026-11-17T12:00:00Z"))).toBe(11);
  });

  it("does not count a year before its anniversary", () => {
    expect(careerYears("2015-09-01", new Date("2026-08-31T12:00:00Z"))).toBe(10);
    expect(careerYears("2015-09-01", new Date("2026-09-01T12:00:00Z"))).toBe(11);
  });

  it("is null without a start date or before the first full year", () => {
    expect(careerYears(null, new Date("2026-11-17T12:00:00Z"))).toBeNull();
    expect(careerYears("2026-03-01", new Date("2026-11-17T12:00:00Z"))).toBeNull();
  });
});
