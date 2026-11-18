import { describe, expect, it } from "vitest";

import { readWebConfig } from "./config";

const SITE = { WEB_SITE_ORIGIN: "https://site.example.test" };
const API = { WEB_API_BASE_URL: "http://api.example.test" };

describe("readWebConfig", () => {
  it("reads the API's base address and the site's canonical origin", () => {
    expect(readWebConfig({ ...API, ...SITE })).toEqual({
      apiBaseUrl: "http://api.example.test",
      siteOrigin: "https://site.example.test",
    });
  });

  it("drops a trailing slash, so request paths join cleanly", () => {
    expect(readWebConfig({ WEB_API_BASE_URL: "https://api.example.test/", ...SITE })).toEqual({
      apiBaseUrl: "https://api.example.test",
      siteOrigin: "https://site.example.test",
    });
  });

  it("keeps a path prefix", () => {
    expect(
      readWebConfig({ WEB_API_BASE_URL: "https://example.test/api/", ...SITE }).apiBaseUrl,
    ).toBe("https://example.test/api");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not an address", "api.example.test"],
    ["another scheme", "ftp://api.example.test"],
  ])("refuses a %s value and names the variable", (_label, value) => {
    const env = value === undefined ? { ...SITE } : { WEB_API_BASE_URL: value, ...SITE };
    expect(() => readWebConfig(env)).toThrow(/WEB_API_BASE_URL/);
  });

  it("refuses credentials in the address and does not repeat them", () => {
    let message = "";
    try {
      readWebConfig({ WEB_API_BASE_URL: "https://user:s3cret@api.example.test", ...SITE });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/WEB_API_BASE_URL/);
    expect(message).not.toContain("s3cret");
  });

  it("refuses a query or fragment, which request paths cannot follow", () => {
    expect(() =>
      readWebConfig({ WEB_API_BASE_URL: "https://api.example.test/?a=1", ...SITE }),
    ).toThrow(/WEB_API_BASE_URL/);
    expect(() =>
      readWebConfig({ WEB_API_BASE_URL: "https://api.example.test/#x", ...SITE }),
    ).toThrow(/WEB_API_BASE_URL/);
  });
});

describe("readWebConfig: the site's canonical origin", () => {
  it("keeps the origin with its port and without a trailing slash", () => {
    expect(
      readWebConfig({ ...API, WEB_SITE_ORIGIN: "http://site.example.test:4100/" }).siteOrigin,
    ).toBe("http://site.example.test:4100");
  });

  it("writes the host in lower case, as a URL compares it", () => {
    expect(readWebConfig({ ...API, WEB_SITE_ORIGIN: "https://Site.Example.TEST" }).siteOrigin).toBe(
      "https://site.example.test",
    );
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not an address", "site.example.test"],
    ["another scheme", "ftp://site.example.test"],
    ["a path", "https://site.example.test/blog"],
    ["a query", "https://site.example.test/?a=1"],
    ["a fragment", "https://site.example.test/#top"],
  ])("refuses a %s value and names the variable", (_label, value) => {
    const env = value === undefined ? { ...API } : { ...API, WEB_SITE_ORIGIN: value };
    expect(() => readWebConfig(env)).toThrow(/WEB_SITE_ORIGIN/);
  });

  it("refuses credentials and does not repeat them", () => {
    let message = "";
    try {
      readWebConfig({ ...API, WEB_SITE_ORIGIN: "https://user:s3cret@site.example.test" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/WEB_SITE_ORIGIN/);
    expect(message).not.toContain("s3cret");
  });

  it("names both variables when both are wrong", () => {
    expect(() => readWebConfig({})).toThrow(/WEB_API_BASE_URL.*WEB_SITE_ORIGIN/);
  });
});
