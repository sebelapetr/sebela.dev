import { describe, expect, it } from "vitest";

import { matchLocalPattern } from "next/dist/shared/lib/match-local-pattern";

import { imageSettings, isImageFileName, mediaFileName, mediaPath } from "./media-source";

// Loopback hosts and explicit ports come from the environment, so they are
// covered by the end-to-end tests (e2e/media.spec.ts); unit tests stay on
// fictional hosts without a port.
const API = "http://api.example.test";
const BASE = `${API}/v1/media/files/development/feat-55`;
const ID = "0b6f4f43-61a4-4c1e-8f0e-6f1c1c5d2a10";
const NAME = `${ID}.png`;
const FILE = `${BASE}/${NAME}`;
const CDN = "https://cdn.example.test/production";

describe("mediaFileName", () => {
  it("names a stored file directly below the media base", () => {
    expect(mediaFileName(FILE, BASE)).toBe(NAME);
    expect(mediaFileName(`${CDN}/${ID}.webp`, CDN)).toBe(`${ID}.webp`);
    expect(mediaFileName(`${BASE}/${ID}.jpg`, `${BASE}/`)).toBe(`${ID}.jpg`);
    expect(mediaFileName(`${BASE}/${ID}.pdf`, BASE)).toBe(`${ID}.pdf`);
  });

  it.each([
    ["the base itself", BASE],
    ["the base with a trailing slash", `${BASE}/`],
    ["another worktree's files", `${API}/v1/media/files/development/feat-54/a.png`],
    ["a sibling folder that shares the prefix", `${BASE}-other/a.png`],
    ["the environment's shared folder", `${API}/v1/media/files/development/a.png`],
    ["another API route", `${API}/v1/person`],
    ["another host", "http://api.example.invalid/v1/media/files/development/feat-55/a.png"],
    [
      "a subdomain of the host",
      "http://x.api.example.test/v1/media/files/development/feat-55/a.png",
    ],
    ["https where the base is http", FILE.replace("http:", "https:")],
    ["the cloud metadata service", "http://169.254.169.254/latest/meta-data/"],
    ["a private network address", "http://10.0.0.5/v1/media/files/development/feat-55/a.png"],
    ["a protocol-relative address", "//api.example.test/v1/media/files/development/feat-55/a.png"],
    ["a relative path", "/v1/media/files/development/feat-55/a.png"],
    ["traversal", `${BASE}/../feat-54/a.png`],
    ["encoded traversal", `${BASE}/%2e%2e/feat-54/a.png`],
    ["upper-case encoded traversal", `${BASE}/%2E%2E/feat-54/a.png`],
    ["an encoded slash", `${BASE}/..%2f..%2fperson`],
    ["an encoded backslash", `${BASE}/..%5c..%5cperson`],
    ["a backslash", `${BASE}\\..\\a.png`],
    ["a nested folder", `${BASE}/nested/a.png`],
    ["a file the storage never writes", `${BASE}/${ID}.svg`],
    ["an upper-case extension", `${BASE}/${ID}.PNG`],
    ["a name of dots", `${BASE}/..png`],
    ["a query", `${FILE}?w=1`],
    ["an empty query", `${FILE}?`],
    ["a fragment", `${FILE}#x`],
    ["credentials", FILE.replace("http://", "http://user:pass@")],
    ["a file address", "file:///etc/passwd"],
    ["a data address", "data:image/png;base64,AAAA"],
    ["the optimizer itself", `${API}/_next/image?url=%2Fa.png&w=64&q=75`],
    ["not an address", "portrait.png"],
  ])("refuses %s", (_label, url) => {
    expect(mediaFileName(url, BASE)).toBeNull();
  });
});

describe("isImageFileName", () => {
  it.each([`${ID}.png`, `${ID}.jpg`, `${ID}.webp`])("accepts the stored image %s", (name) => {
    expect(isImageFileName(name)).toBe(true);
  });

  it.each([
    `${ID}.pdf`,
    `${ID}.svg`,
    `${ID}.jpeg`,
    `${ID}.PNG`,
    "..png",
    ".png",
    `../${ID}.png`,
    `${ID}.png/x`,
    `${ID}.png?w=1`,
    "",
  ])("refuses %s", (name) => {
    expect(isImageFileName(name)).toBe(false);
  });
});

describe("mediaPath", () => {
  it("serves a stored image from the site's own media path", () => {
    expect(mediaPath(NAME)).toBe(`/media/${NAME}`);
  });
});

describe("imageSettings", () => {
  const settings = imageSettings();

  it("lets the optimizer read only the site's own media path, never another host", () => {
    expect(settings.localPatterns).toEqual([
      { pathname: "/media/+([A-Za-z0-9-]).@(png|jpg|webp)", search: "" },
    ]);
    expect(settings.remotePatterns).toEqual([]);
    expect(settings.dangerouslyAllowLocalIP).toBe(false);
    expect(settings.maximumRedirects).toBe(0);
  });

  it("matches, with Next's own matcher, exactly the paths mediaPath gives a stored image", () => {
    const [pattern] = settings.localPatterns ?? [];
    if (pattern === undefined) throw new Error("No local pattern");
    const candidates: [string, boolean][] = [
      [mediaPath(NAME), true],
      [mediaPath(`${ID}.jpg`), true],
      [mediaPath(`${ID}.webp`), true],
      [mediaPath(`${ID}.pdf`), false],
      [mediaPath(`${ID}.svg`), false],
      [`/media/nested/${NAME}`, false],
      [`/media/%2e%2e.png`, false],
      [`/media/..%2f..%2fperson.png`, false],
      [`${mediaPath(NAME)}?w=1`, false],
      [`/v1/media/files/test/${NAME}`, false],
      [`/cv/pdf`, false],
      [`/_next/image?url=${encodeURIComponent(mediaPath(NAME))}`, false],
    ];
    for (const [candidate, expected] of candidates) {
      const matched = matchLocalPattern(pattern, new URL(candidate, "http://site.example.test"));
      expect({ candidate, matched }).toEqual({ candidate, matched: expected });
    }
  });

  it("needs no setting, so the build and the server agree whatever the environment says", () => {
    expect(imageSettings()).toEqual(settings);
  });

  it("offers only the widths the site renders, in WebP", () => {
    expect(settings.formats).toEqual(["image/webp"]);
    expect(Math.max(...(settings.deviceSizes ?? []))).toBeLessThanOrEqual(1080);
    expect(settings.qualities).toEqual([75]);
  });
});
