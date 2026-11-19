import { describe, expect, it } from "vitest";

import { indexedPaths, robotsTxt, sitemapXml } from "./indexing";

const ORIGIN = "https://site.example.test";

function locations(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1] ?? "");
}

describe("indexedPaths", () => {
  it("are the real, stable pages of the profile", () => {
    expect(indexedPaths).toEqual(["/", "/experience", "/services", "/cv"]);
  });

  it("never include the chat, its conversations or the PDF download", () => {
    for (const path of indexedPaths) {
      expect(path).not.toMatch(/^\/(?:ask|cv\/pdf)/);
      expect(path).not.toContain("?");
    }
  });
});

describe("sitemapXml", () => {
  it("lists every indexed page on the configured origin", () => {
    const xml = sitemapXml(ORIGIN);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(locations(xml)).toEqual([
      "https://site.example.test/",
      "https://site.example.test/experience",
      "https://site.example.test/services",
      "https://site.example.test/cv",
    ]);
  });

  it("lists the further pages it is given after the indexed pages, in their order", () => {
    expect(
      locations(sitemapXml(ORIGIN, ["/ai-roadmap", "/ai-roadmap/odd%2Fslug"])).slice(4),
    ).toEqual([
      "https://site.example.test/ai-roadmap",
      "https://site.example.test/ai-roadmap/odd%2Fslug",
    ]);
  });

  it("follows another configured origin", () => {
    expect(locations(sitemapXml("http://other.example.test"))[0]).toBe(
      "http://other.example.test/",
    );
  });

  it("escapes an origin's XML characters", () => {
    const xml = sitemapXml("https://a&b.example.test");
    expect(xml).toContain("<loc>https://a&amp;b.example.test/</loc>");
    expect(xml).not.toContain("a&b");
  });
});

describe("robotsTxt", () => {
  it("lets every crawler read the site and points at the sitemap on the configured origin", () => {
    expect(robotsTxt(ORIGIN)).toBe(
      "User-agent: *\nAllow: /\n\nSitemap: https://site.example.test/sitemap.xml\n",
    );
  });

  it("follows another configured origin", () => {
    expect(robotsTxt("http://other.example.test")).toContain(
      "Sitemap: http://other.example.test/sitemap.xml",
    );
  });
});
