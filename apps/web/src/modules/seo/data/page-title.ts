// Page titles short enough for a search result to show whole: `Page · Parent · Person`, with the
// parent dropped and then the page's name shortened at a word when the title would be too long. The
// person's name, which names the site, is never shortened. Lengths count the characters a reader
// sees (grapheme clusters), so a cut never splits a flag, a joined emoji or an accented letter, and
// a separator or punctuation left at the cut is dropped before the "…".

/** The longest title, so a search result shows it whole. */
export const TITLE_MAX = 60;

/** What joins a title's parts. */
const SEPARATOR = " · ";

/** The shortest a page's name or a descriptor is shortened to; below it the part says too little. */
const PART_MIN = 16;

/**
 * A page's title: the page's name, the names of its parents nearest first while they fit, then the
 * site's `site` name (the person's). Parents are dropped from the farthest; when the page's name
 * alone is too long it is shortened at a word, ending in "…", but never below a readable length,
 * so a very long `site` name may make the title longer than `TITLE_MAX` rather than unreadable.
 */
export function pageTitle(site: string, page: string, ...context: readonly string[]): string {
  for (let parents = context.length; parents >= 0; parents -= 1) {
    const title = [page, ...context.slice(0, parents), site].join(SEPARATOR);
    if (length(title) <= TITLE_MAX) return title;
  }
  const room = Math.max(TITLE_MAX - length(site) - SEPARATOR.length, PART_MIN);
  return `${shorten(page, room)}${SEPARATOR}${site}`;
}

/**
 * The homepage's title: the person's name with the headline as a short descriptor, shortened at a
 * word to fit; only the name when too little of the headline would fit beside it.
 */
export function homepageTitle(name: string, headline: string): string {
  const room = TITLE_MAX - length(name) - SEPARATOR.length;
  if (room < PART_MIN) return name;
  return `${name}${SEPARATOR}${shorten(headline, room)}`;
}

const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Whitespace, dashes and other punctuation that would dangle before the "…", such as " ·" or " —". */
const DANGLING_END = /[\s\p{Pd}\p{Po}|]+$/u;

/** The characters a reader sees in `text`, each a whole grapheme cluster. */
function characters(text: string): string[] {
  return Array.from(GRAPHEMES.segment(text), (part) => part.segment);
}

function length(text: string): number {
  return characters(text).length;
}

/**
 * `text` within `max` characters: cut at the last word that fits, or inside one long word, then
 * "…", with any separator or punctuation left at the cut dropped.
 */
function shorten(text: string, max: number): string {
  const all = characters(text);
  if (all.length <= max) return text;
  const cut = all.slice(0, max - 1);
  const space = all[max - 1] === " " ? cut.length : cut.lastIndexOf(" ");
  const kept = (space > 0 ? cut.slice(0, space) : cut).join("");
  const trimmed = kept.replace(DANGLING_END, "");
  return `${trimmed === "" ? kept.trimEnd() : trimmed}…`;
}
