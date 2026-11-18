// What crawlers are told: the sitemap lists the profile's real, stable pages on the configured
// origin, and robots.txt lets every crawler read the site and points at the sitemap. The chat (and
// its conversations), the AI Roadmap's placeholder and the CV PDF's download and failure pages are
// never listed; those pages say `noindex` themselves, which crawlers can only read when robots.txt
// does not block them.
import { routes } from "../../_shared";

/** The pages search engines may index, in the sitemap's order. */
export const indexedPaths: readonly string[] = [
  routes.home,
  routes.experience,
  routes.services,
  routes.cv,
];

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

/** The sitemap of the indexed pages on `origin`, without dates the profile cannot vouch for. */
export function sitemapXml(origin: string): string {
  const urls = indexedPaths.map(
    (path) => `  <url><loc>${escapeXml(`${origin}${path}`)}</loc></url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

/** robots.txt: every crawler may read the site; the sitemap is on `origin`. */
export function robotsTxt(origin: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
}
