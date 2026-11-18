// Markdown reduced to plain words, for text that is not rendered as Markdown: the Ask page's
// answers, page descriptions, structured data and llms.txt.

/**
 * The first paragraph of a Markdown text as plain words on one line, without marks or link
 * targets, cut at a word with an ellipsis to at most `max` characters; empty without words.
 */
export function plainText(markdown: string, max = 280): string {
  const paragraph = markdown.trim().split(/\n\s*\n/, 1)[0] ?? "";
  const words = paragraph
    .split("\n")
    .map((line) => line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, ""))
    .join(" ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (words.length <= max) return words;
  const cut = words.slice(0, max - 1);
  const space = words[max - 1] === " " ? cut.length : cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
