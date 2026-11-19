// What an indexed page's Open Graph preview image says: the site's host, the page's name, the
// person's name and headline from the profile, shortened to fit the card, or the site's own card
// when the profile cannot be read. The preview images live at `/og/<page>` on the origin.
import type { PageFacts } from "./page-metadata";
import { isIndexedPage, PAGES, type IndexedPage } from "./pages";

/** The preview image's size in pixels, the size Open Graph and large Twitter cards expect. */
export const OPEN_GRAPH_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/** The longest title and subtitle on a card, so both fit its lines at the card's type sizes. */
const TITLE_MAX = 60;
const SUBTITLE_MAX = 120;

/** What a preview image shows; every value is plain text, never markup. */
export interface OpenGraphCard {
  /** The origin's host, for example `example.test`. */
  readonly site: string;
  /** The page's name, or `null` for the homepage. */
  readonly label: string | null;
  readonly title: string;
  readonly subtitle: string | null;
}

/** Whether a route segment names a page with a preview image. */
export function isPreviewPage(value: string): value is IndexedPage {
  return isIndexedPage(value);
}

/** The address of a page's preview image on the origin, for example `https://example.test/og/cv`. */
export function openGraphImageUrl(origin: string, page: IndexedPage): string {
  return `${origin}/og/${page}`;
}

/**
 * A card with the given texts, shortened to fit: `title` and `subtitle` on the card of `origin`'s
 * host under `label`.
 */
export function textCard(
  origin: string,
  label: string,
  title: string,
  subtitle: string | null,
): OpenGraphCard {
  return {
    site: new URL(origin).host,
    label,
    title: shorten(title, TITLE_MAX),
    subtitle: subtitle === null ? null : shorten(subtitle, SUBTITLE_MAX),
  };
}

/** Cuts text to at most `max` characters, ending with an ellipsis when it was cut. */
function shorten(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The card of `page` on `origin`: the person's name and headline when `facts` are there, otherwise
 * the site's host as the title and no subtitle.
 */
export function openGraphCard(
  origin: string,
  page: IndexedPage,
  facts: PageFacts | null,
): OpenGraphCard {
  const site = new URL(origin).host;
  const { label } = PAGES[page];
  if (facts === null) return { site, label, title: site, subtitle: null };
  return {
    site,
    label,
    title: shorten(facts.name, TITLE_MAX),
    subtitle: shorten(facts.headline, SUBTITLE_MAX),
  };
}
