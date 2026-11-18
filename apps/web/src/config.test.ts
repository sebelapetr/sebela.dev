import { describe, expect, it } from "vitest";

import { readWebConfig } from "./config";

const SITE = { WEB_SITE_ORIGIN: "https://site.example.test" };
const API = { WEB_API_BASE_URL: "http://api.example.test" };
const MEDIA = { WEB_MEDIA_BASE_URL: "http://api.example.test/v1/media/files/test" };

describe("readWebConfig", () => {
  it("reads the API's base address and the site's canonical origin", () => {
    expect(readWebConfig({ ...API, ...SITE, ...MEDIA })).toEqual({
      apiBaseUrl: "http://api.example.test",
      siteOrigin: "https://site.example.test",
      mediaBaseUrl: "http://api.example.test/v1/media/files/test",
    });
  });

  it("drops a trailing slash, so request paths join cleanly", () => {
    expect(
      readWebConfig({ WEB_API_BASE_URL: "https://api.example.test/", ...SITE, ...MEDIA }),
    ).toEqual({
      apiBaseUrl: "https://api.example.test",
      siteOrigin: "https://site.example.test",
      mediaBaseUrl: "http://api.example.test/v1/media/files/test",
    });
  });

  it("keeps a path prefix", () => {
    expect(
      readWebConfig({ WEB_API_BASE_URL: "https://example.test/api/", ...SITE, ...MEDIA })
        .apiBaseUrl,
    ).toBe("https://example.test/api");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not an address", "api.example.test"],
    ["another scheme", "ftp://api.example.test"],
  ])("refuses a %s value and names the variable", (_label, value) => {
    const env =
      value === undefined ? { ...SITE, ...MEDIA } : { WEB_API_BASE_URL: value, ...SITE, ...MEDIA };
    expect(() => readWebConfig(env)).toThrow(/WEB_API_BASE_URL/);
  });

  it("refuses credentials in the address and does not repeat them", () => {
    let message = "";
    try {
      readWebConfig({
        WEB_API_BASE_URL: "https://user:s3cret@api.example.test",
        ...SITE,
        ...MEDIA,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/WEB_API_BASE_URL/);
    expect(message).not.toContain("s3cret");
  });

  it("refuses a query or fragment, which request paths cannot follow", () => {
    expect(() =>
      readWebConfig({ WEB_API_BASE_URL: "https://api.example.test/?a=1", ...SITE, ...MEDIA }),
    ).toThrow(/WEB_API_BASE_URL/);
    expect(() =>
      readWebConfig({ WEB_API_BASE_URL: "https://api.example.test/#x", ...SITE, ...MEDIA }),
    ).toThrow(/WEB_API_BASE_URL/);
  });
});

describe("readWebConfig: the site's canonical origin", () => {
  it("keeps the origin without a trailing slash", () => {
    expect(
      readWebConfig({ ...API, ...MEDIA, WEB_SITE_ORIGIN: "http://site.example.test/" }).siteOrigin,
    ).toBe("http://site.example.test");
  });

  it("writes the host in lower case, as a URL compares it", () => {
    expect(
      readWebConfig({ ...API, ...MEDIA, WEB_SITE_ORIGIN: "https://Site.Example.TEST" }).siteOrigin,
    ).toBe("https://site.example.test");
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
    const env =
      value === undefined ? { ...API, ...MEDIA } : { ...API, ...MEDIA, WEB_SITE_ORIGIN: value };
    expect(() => readWebConfig(env)).toThrow(/WEB_SITE_ORIGIN/);
  });

  it("refuses credentials and does not repeat them", () => {
    let message = "";
    try {
      readWebConfig({ ...API, ...MEDIA, WEB_SITE_ORIGIN: "https://user:s3cret@site.example.test" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/WEB_SITE_ORIGIN/);
    expect(message).not.toContain("s3cret");
  });

  it("names every variable when all are wrong", () => {
    expect(() => readWebConfig({})).toThrow(
      /WEB_API_BASE_URL.*WEB_SITE_ORIGIN.*WEB_MEDIA_BASE_URL/,
    );
  });
});

describe("readWebConfig: the media files' base address", () => {
  const read = (value: string) =>
    readWebConfig({ ...API, ...SITE, WEB_MEDIA_BASE_URL: value }).mediaBaseUrl;

  it("keeps the storage's environment and worktree folders without a trailing slash", () => {
    expect(read("http://api.example.test/v1/media/files/development/feat-1/")).toBe(
      "http://api.example.test/v1/media/files/development/feat-1",
    );
  });

  it("accepts a CDN's https address", () => {
    expect(read("https://cdn.example.test/production")).toBe("https://cdn.example.test/production");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not an address", "cdn.example.test/production"],
    ["another scheme", "file:///var/storage/production"],
    ["a data address", "data:image/png;base64,AAAA"],
    ["a query", "https://cdn.example.test/production?a=1"],
    ["a fragment", "https://cdn.example.test/production#top"],
    ["no folder", "https://cdn.example.test/"],
    ["a dot segment", "https://cdn.example.test/production/%2e%2e/other"],
    ["an encoded separator", "https://cdn.example.test/production%2Fother"],
  ])("refuses %s as the media base and names the variable", (_label, value) => {
    const env =
      value === undefined ? { ...API, ...SITE } : { ...API, ...SITE, WEB_MEDIA_BASE_URL: value };
    expect(() => readWebConfig(env)).toThrow(/WEB_MEDIA_BASE_URL/);
  });

  it("refuses credentials and does not repeat them", () => {
    expect(() => read("https://user:s3cret@cdn.example.test/production")).toThrow(
      /^(?!.*s3cret).*WEB_MEDIA_BASE_URL/,
    );
  });
});
