import { describe, expect, it } from "vitest";

import { copyrightLine } from "./copyright";

describe("copyrightLine", () => {
  it("names the current year and the person", () => {
    expect(copyrightLine("Jordan Example", new Date(2031, 4, 2))).toBe("© 2031 Jordan Example");
  });

  it("follows the year of the given day, never a fixed one", () => {
    expect(copyrightLine("Jordan Example", new Date(2040, 0, 1))).toBe("© 2040 Jordan Example");
  });

  it("shows the year alone without a readable profile", () => {
    expect(copyrightLine(null, new Date(2031, 4, 2))).toBe("© 2031");
  });
});
