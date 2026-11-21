import { describe, expect, it } from "vitest";

import {
  readAnalyticsConfig,
  readIndexingConfig,
  readInvalidationSecret,
  readWebConfig,
} from "./config";

const SITE = { WEB_SITE_ORIGIN: "https://site.example.test" };
const API = { WEB_API_BASE_URL: "http://api.example.test" };
const MEDIA = { WEB_MEDIA_BASE_URL: "http://api.example.test/v1/media/files/test" };

describe("readWebConfig", () => {
  it("reads the API's base address and the site's canonical origin", () => {
    expect(readWebConfig({ ...API, ...SITE, ...MEDIA })).toEqual({
      apiBaseUrl: "http://api.example.test",
      siteOrigin: "https://site.example.test",
      mediaBaseUrl: "http://api.example.test/v1/media/files/test",
      mediaReadBaseUrl: "http://api.example.test/v1/media/files/test",
      contentRevalidateMs: 60_000,
    });
  });

  it("drops a trailing slash, so request paths join cleanly", () => {
    expect(
      readWebConfig({ WEB_API_BASE_URL: "https://api.example.test/", ...SITE, ...MEDIA }),
    ).toEqual({
      apiBaseUrl: "https://api.example.test",
      siteOrigin: "https://site.example.test",
      mediaBaseUrl: "http://api.example.test/v1/media/files/test",
      mediaReadBaseUrl: "http://api.example.test/v1/media/files/test",
      contentRevalidateMs: 60_000,
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

describe("readWebConfig: where the server reads the media files", () => {
  const read = (value: string | undefined) =>
    readWebConfig(
      value === undefined
        ? { ...API, ...SITE, ...MEDIA }
        : { ...API, ...SITE, ...MEDIA, WEB_MEDIA_READ_BASE_URL: value },
    ).mediaReadBaseUrl;

  it("is the media base itself when unset or empty, as on a host", () => {
    expect(read(undefined)).toBe("http://api.example.test/v1/media/files/test");
    expect(read("")).toBe("http://api.example.test/v1/media/files/test");
  });

  it("keeps a separate read address without a trailing slash", () => {
    expect(read("http://api/v1/media/files/development/feat-1/")).toBe(
      "http://api/v1/media/files/development/feat-1",
    );
  });

  it.each([
    ["not an address", "api/v1/media/files/test"],
    ["another scheme", "file:///var/storage/test"],
    ["a query", "http://api/v1/media/files/test?a=1"],
    ["no folder", "http://api/"],
    ["an encoded separator", "http://api/v1/media/files%2Ftest"],
  ])("refuses %s and names the variable", (_label, value) => {
    expect(() => read(value)).toThrow(/WEB_MEDIA_READ_BASE_URL/);
  });

  it("refuses credentials and does not repeat them", () => {
    expect(() => read("http://user:s3cret@api/v1/media/files/test")).toThrow(
      /^(?!.*s3cret).*WEB_MEDIA_READ_BASE_URL/,
    );
  });
});

describe("readWebConfig: a container next to the API", () => {
  it("reads the API and the media files internally and names only public origins to visitors", () => {
    expect(
      readWebConfig({
        WEB_API_BASE_URL: "http://api",
        WEB_SITE_ORIGIN: "http://site.example.test",
        WEB_MEDIA_BASE_URL: "http://media.example.test/v1/media/files/development/feat-1",
        WEB_MEDIA_READ_BASE_URL: "http://api/v1/media/files/development/feat-1",
      }),
    ).toEqual({
      apiBaseUrl: "http://api",
      siteOrigin: "http://site.example.test",
      mediaBaseUrl: "http://media.example.test/v1/media/files/development/feat-1",
      mediaReadBaseUrl: "http://api/v1/media/files/development/feat-1",
      contentRevalidateMs: 60_000,
    });
  });
});

describe("readWebConfig: the content cache's fallback revalidation interval", () => {
  const read = (value: string | undefined) =>
    readWebConfig(
      value === undefined
        ? { ...API, ...SITE, ...MEDIA }
        : { ...API, ...SITE, ...MEDIA, WEB_CONTENT_REVALIDATE_SECONDS: value },
    ).contentRevalidateMs;

  it("is sixty seconds when unset or empty", () => {
    expect(read(undefined)).toBe(60_000);
    expect(read("")).toBe(60_000);
  });

  it("reads a configured whole number of seconds", () => {
    expect(read("5")).toBe(5_000);
    expect(read("1")).toBe(1_000);
    expect(read("86400")).toBe(86_400_000);
  });

  it.each([
    ["zero", "0"],
    ["a negative number", "-5"],
    ["a fraction", "1.5"],
    ["a unit", "60s"],
    ["text", "soon"],
    ["more than a day", "86401"],
  ])("refuses %s and names the variable", (_label, value) => {
    expect(() => read(value)).toThrow(/WEB_CONTENT_REVALIDATE_SECONDS/);
  });
});

describe("readInvalidationSecret", () => {
  // Disposable fixture values, used by nothing but these tests.
  const secret = "fixture-secret-for-tests-only-0123456789";

  it("reads the website's invalidation signing secret", () => {
    expect(readInvalidationSecret({ WEB_INVALIDATION_SECRET: secret })).toBe(secret);
  });

  it("needs nothing else of the website's configuration", () => {
    expect(readInvalidationSecret({ ...API, WEB_INVALIDATION_SECRET: secret })).toBe(secret);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
  ])("refuses a %s secret and names the variable", (_label, value) => {
    const env = value === undefined ? {} : { WEB_INVALIDATION_SECRET: value };
    expect(() => readInvalidationSecret(env)).toThrow(/WEB_INVALIDATION_SECRET is required/);
  });

  it("refuses a secret shorter than 32 characters and does not repeat it", () => {
    const short = "x".repeat(31);
    expect(() => readInvalidationSecret({ WEB_INVALIDATION_SECRET: short })).toThrow(
      /^(?!.*x{31}).*WEB_INVALIDATION_SECRET must be at least 32 characters/,
    );
    expect(readInvalidationSecret({ WEB_INVALIDATION_SECRET: "x".repeat(32) })).toHaveLength(32);
  });
});

describe("readAnalyticsConfig", () => {
  // A fictional tracker address and website identifier, used by nothing but these tests.
  const SCRIPT = "https://analytics.example.test/script.js";
  const WEBSITE = "0b6e1d6c-4f3a-4c8e-9d2b-7a5f3e1c2b4a";
  const read = (env: Record<string, string | undefined>) =>
    readAnalyticsConfig({ ...SITE, ...env });
  const messageOf = (env: Record<string, string | undefined>) => {
    try {
      read(env);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    return "";
  };

  it("reads the tracker's script address and the website identifier", () => {
    expect(read({ WEB_ANALYTICS_SCRIPT_URL: SCRIPT, WEB_ANALYTICS_WEBSITE_ID: WEBSITE })).toEqual({
      scriptUrl: SCRIPT,
      websiteId: WEBSITE,
    });
  });

  it("writes the website identifier in lower case", () => {
    expect(
      read({ WEB_ANALYTICS_SCRIPT_URL: SCRIPT, WEB_ANALYTICS_WEBSITE_ID: WEBSITE.toUpperCase() })
        ?.websiteId,
    ).toBe(WEBSITE);
  });

  it.each([
    ["unset", {}],
    ["empty", { WEB_ANALYTICS_SCRIPT_URL: "", WEB_ANALYTICS_WEBSITE_ID: "" }],
  ])("turns analytics off when both settings are %s", (_label, env) => {
    expect(read(env)).toBeNull();
  });

  it("needs nothing else of the website's configuration", () => {
    expect(
      readAnalyticsConfig({ WEB_ANALYTICS_SCRIPT_URL: SCRIPT, WEB_ANALYTICS_WEBSITE_ID: WEBSITE }),
    ).toEqual({ scriptUrl: SCRIPT, websiteId: WEBSITE });
  });

  it("refuses a script address without a website identifier, and the other way round", () => {
    expect(() => read({ WEB_ANALYTICS_SCRIPT_URL: SCRIPT })).toThrow(/WEB_ANALYTICS_WEBSITE_ID/);
    expect(() => read({ WEB_ANALYTICS_WEBSITE_ID: WEBSITE })).toThrow(/WEB_ANALYTICS_SCRIPT_URL/);
  });

  it.each([
    ["not an address", "analytics.example.test/script.js"],
    ["another scheme", "ftp://analytics.example.test/script.js"],
    ["a plain http address on an https site", "http://analytics.example.test/script.js"],
    ["no script path", "https://analytics.example.test/"],
    ["a query", "https://analytics.example.test/script.js?v=1"],
    ["a fragment", "https://analytics.example.test/script.js#x"],
  ])("refuses a script address with %s and names the variable", (_label, value) => {
    expect(
      messageOf({ WEB_ANALYTICS_SCRIPT_URL: value, WEB_ANALYTICS_WEBSITE_ID: WEBSITE }),
    ).toMatch(/WEB_ANALYTICS_SCRIPT_URL/);
  });

  it("refuses credentials in the script address and does not repeat them", () => {
    const message = messageOf({
      WEB_ANALYTICS_SCRIPT_URL: "https://user:s3cret@analytics.example.test/script.js",
      WEB_ANALYTICS_WEBSITE_ID: WEBSITE,
    });
    expect(message).toMatch(/WEB_ANALYTICS_SCRIPT_URL must not contain credentials/);
    expect(message).not.toContain("s3cret");
  });

  it("accepts a plain http script address only on a plain http site, as in local tests", () => {
    const local = "http://analytics.example.test/script.js";
    expect(
      readAnalyticsConfig({
        WEB_SITE_ORIGIN: "http://site.example.test",
        WEB_ANALYTICS_SCRIPT_URL: local,
        WEB_ANALYTICS_WEBSITE_ID: WEBSITE,
      }),
    ).toEqual({ scriptUrl: local, websiteId: WEBSITE });
    expect(() =>
      readAnalyticsConfig({ WEB_ANALYTICS_SCRIPT_URL: local, WEB_ANALYTICS_WEBSITE_ID: WEBSITE }),
    ).toThrow(/WEB_ANALYTICS_SCRIPT_URL must be an https address/);
  });

  it.each([
    ["not an identifier", "my-website"],
    ["markup", '0b6e1d6c-4f3a-4c8e-9d2b-7a5f3e1c2b4a"><script>'],
    ["too short", "0b6e1d6c-4f3a-4c8e-9d2b-7a5f3e1c2b4"],
  ])(
    "refuses a website identifier that is %s, names the variable and not the value",
    (_l, value) => {
      const message = messageOf({
        WEB_ANALYTICS_SCRIPT_URL: SCRIPT,
        WEB_ANALYTICS_WEBSITE_ID: value,
      });
      expect(message).toMatch(/WEB_ANALYTICS_WEBSITE_ID must be a UUID/);
      expect(message).not.toContain(value);
    },
  );
});

describe("readIndexingConfig", () => {
  it("keeps the site out of search engines when WEB_INDEXING is unset, empty or off", () => {
    expect(readIndexingConfig({})).toBe(false);
    expect(readIndexingConfig({ WEB_INDEXING: "" })).toBe(false);
    expect(readIndexingConfig({ WEB_INDEXING: "off" })).toBe(false);
  });

  it("lets search engines index the site only when WEB_INDEXING is on", () => {
    expect(readIndexingConfig({ WEB_INDEXING: "on" })).toBe(true);
  });

  it("refuses any other value, naming the variable and never its value", () => {
    for (const value of ["true", "ON", "1", "yes", " on"]) {
      expect(() => readIndexingConfig({ WEB_INDEXING: value })).toThrow(
        /WEB_INDEXING must be on or off/,
      );
    }
    expect(() => readIndexingConfig({ WEB_INDEXING: "s3cret" })).not.toThrow(/s3cret/);
  });
});
