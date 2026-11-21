import { describe, expect, it } from "vitest";

import { createIndexingSettings, indexingHeaders, indexingMetadata } from "./indexing";

function settings() {
  const lines: string[] = [];
  const allowed = createIndexingSettings((line) => lines.push(line));
  return { allowed, lines };
}

describe("createIndexingSettings", () => {
  it("keeps the site out of search engines by default and says nothing", () => {
    const { allowed, lines } = settings();
    expect(allowed({})).toBe(false);
    expect(allowed({ WEB_INDEXING: "off" })).toBe(false);
    expect(lines).toEqual([]);
  });

  it("allows indexing when WEB_INDEXING is on", () => {
    const { allowed, lines } = settings();
    expect(allowed({ WEB_INDEXING: "on" })).toBe(true);
    expect(lines).toEqual([]);
  });

  it("fails closed on an unusable value and reports it once, without its value", () => {
    const { allowed, lines } = settings();
    expect(allowed({ WEB_INDEXING: "s3cret" })).toBe(false);
    expect(allowed({ WEB_INDEXING: "s3cret" })).toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/indexing is off: .*WEB_INDEXING must be on or off/);
    expect(lines[0]).not.toContain("s3cret");
  });
});

describe("indexingHeaders", () => {
  it("asks search engines not to index or follow anything while indexing is off", () => {
    expect(indexingHeaders(false)).toEqual({ "X-Robots-Tag": "noindex, nofollow" });
  });

  it("adds nothing while indexing is on", () => {
    expect(indexingHeaders(true)).toEqual({});
  });
});

describe("indexingMetadata", () => {
  it("puts noindex and nofollow into the page's robots meta tag while indexing is off", () => {
    expect(indexingMetadata(false)).toEqual({ robots: { index: false, follow: false } });
  });

  it("adds no robots meta tag while indexing is on", () => {
    expect(indexingMetadata(true)).toEqual({});
  });
});
