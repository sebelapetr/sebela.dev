import { describe, expect, it } from "vitest";

import { readWebConfig } from "./config";

describe("readWebConfig", () => {
  it("reads the API's base address", () => {
    expect(readWebConfig({ WEB_API_BASE_URL: "http://api.example.test:4100" })).toEqual({
      apiBaseUrl: "http://api.example.test:4100",
    });
  });

  it("drops a trailing slash, so request paths join cleanly", () => {
    expect(readWebConfig({ WEB_API_BASE_URL: "https://api.example.test/" })).toEqual({
      apiBaseUrl: "https://api.example.test",
    });
  });

  it("keeps a path prefix", () => {
    expect(readWebConfig({ WEB_API_BASE_URL: "https://example.test/api/" }).apiBaseUrl).toBe(
      "https://example.test/api",
    );
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not an address", "api.example.test"],
    ["another scheme", "ftp://api.example.test"],
  ])("refuses a %s value and names the variable", (_label, value) => {
    const env = value === undefined ? {} : { WEB_API_BASE_URL: value };
    expect(() => readWebConfig(env)).toThrow(/WEB_API_BASE_URL/);
  });

  it("refuses credentials in the address and does not repeat them", () => {
    let message = "";
    try {
      readWebConfig({ WEB_API_BASE_URL: "https://user:s3cret@api.example.test" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/WEB_API_BASE_URL/);
    expect(message).not.toContain("s3cret");
  });

  it("refuses a query or fragment, which request paths cannot follow", () => {
    expect(() => readWebConfig({ WEB_API_BASE_URL: "https://api.example.test/?a=1" })).toThrow(
      /WEB_API_BASE_URL/,
    );
    expect(() => readWebConfig({ WEB_API_BASE_URL: "https://api.example.test/#x" })).toThrow(
      /WEB_API_BASE_URL/,
    );
  });
});
