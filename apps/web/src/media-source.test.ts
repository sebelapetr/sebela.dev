import { describe, expect, it } from "vitest";

import { matchRemotePattern } from "next/dist/shared/lib/match-remote-pattern";

import { imageSettings, isMediaUrl } from "./media-source";

// Loopback hosts and explicit ports come from the environment, so they are
// covered by the end-to-end tests (e2e/media.spec.ts); unit tests stay on
// fictional hosts without a port.
const API = "http://api.example.test";
const BASE = `${API}/v1/media/files/development/feat-55`;
const FILE = `${BASE}/0b6f4f43-61a4-4c1e-8f0e-6f1c1c5d2a10.png`;
const CDN = "https://cdn.example.test/production";

describe("isMediaUrl", () => {
  it("accepts a file directly below the media base", () => {
    expect(isMediaUrl(FILE, BASE)).toBe(true);
    expect(isMediaUrl(`${CDN}/0b6f4f43-61a4-4c1e-8f0e-6f1c1c5d2a10.webp`, CDN)).toBe(true);
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
    ["a file that is not an image", `${BASE}/0b6f4f43-61a4-4c1e-8f0e-6f1c1c5d2a10.pdf`],
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
    expect(isMediaUrl(url, BASE)).toBe(false);
  });
});

describe("imageSettings", () => {
  it("lets the optimizer fetch only the configured media folder, without a query", () => {
    expect(imageSettings({ WEB_MEDIA_BASE_URL: CDN }).remotePatterns).toEqual([
      {
        protocol: "https",
        hostname: "cdn.example.test",
        port: "",
        pathname: "/production/+([A-Za-z0-9-]).@(png|jpg|webp)",
        search: "",
      },
    ]);
  });

  it("keeps the worktree's own folder", () => {
    expect(imageSettings({ WEB_MEDIA_BASE_URL: `${BASE}/` }).remotePatterns).toEqual([
      {
        protocol: "http",
        hostname: "api.example.test",
        port: "",
        pathname: "/v1/media/files/development/feat-55/+([A-Za-z0-9-]).@(png|jpg|webp)",
        search: "",
      },
    ]);
  });

  it("matches, with Next's own matcher, exactly the files isMediaUrl accepts", () => {
    const [pattern] = imageSettings({ WEB_MEDIA_BASE_URL: BASE }).remotePatterns ?? [];
    if (pattern === undefined || pattern instanceof URL) throw new Error("No remote pattern");
    const candidates = [
      FILE,
      `${BASE}/a.jpg`,
      `${BASE}/a.webp`,
      `${BASE}/a.pdf`,
      `${BASE}/..%2f..%2fperson.png`,
      `${BASE}/%2e%2e.png`,
      `${BASE}/nested/a.png`,
      `${BASE}-other/a.png`,
      `${FILE}?w=1`,
      `${API}/v1/media/files/development/a.png`,
      `${API}/v1/person`,
    ];
    for (const candidate of candidates) {
      expect({ candidate, matched: matchRemotePattern(pattern, new URL(candidate)) }).toEqual({
        candidate,
        matched: isMediaUrl(candidate, BASE),
      });
    }
    expect(matchRemotePattern(pattern, new URL(FILE))).toBe(true);
  });

  it("allows no local image paths and follows no redirect", () => {
    const settings = imageSettings({ WEB_MEDIA_BASE_URL: CDN });
    expect(settings.localPatterns).toEqual([]);
    expect(settings.maximumRedirects).toBe(0);
  });

  it("refuses private addresses for a public media host", () => {
    expect(imageSettings({ WEB_MEDIA_BASE_URL: CDN }).dangerouslyAllowLocalIP).toBe(false);
    expect(imageSettings({ WEB_MEDIA_BASE_URL: BASE }).dangerouslyAllowLocalIP).toBe(false);
    expect(
      imageSettings({ WEB_MEDIA_BASE_URL: "http://[2001:db8::abcd]/v1/media/files/test" })
        .dangerouslyAllowLocalIP,
    ).toBe(false);
  });

  it.each([
    ["a private network address", "http://10.0.0.5/v1/media/files/test"],
    ["another private network address", "http://192.168.1.20/v1/media/files/test"],
    ["a unique local IPv6 address", "http://[fdab::cdef]/v1/media/files/test"],
  ])("allows private addresses only when the base itself is %s", (_label, base) => {
    expect(imageSettings({ WEB_MEDIA_BASE_URL: base }).dangerouslyAllowLocalIP).toBe(true);
  });

  it.each([
    ["missing", undefined],
    ["invalid", "ftp://cdn.example.test/production"],
    ["the bare origin", "https://cdn.example.test"],
    ["with a query", "https://cdn.example.test/production?x=1"],
  ])("lets the optimizer fetch nothing when the base is %s", (_label, value) => {
    const settings = imageSettings(value === undefined ? {} : { WEB_MEDIA_BASE_URL: value });
    expect(settings.remotePatterns).toEqual([]);
    expect(settings.dangerouslyAllowLocalIP).toBe(false);
  });

  it("offers only the widths the site renders, in WebP", () => {
    const settings = imageSettings({ WEB_MEDIA_BASE_URL: CDN });
    expect(settings.formats).toEqual(["image/webp"]);
    expect(Math.max(...(settings.deviceSizes ?? []))).toBeLessThanOrEqual(1080);
    expect(settings.qualities).toEqual([75]);
  });
});
