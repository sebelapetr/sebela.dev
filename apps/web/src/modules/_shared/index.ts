// The shared module: what the website's modules and routes have in common — the footer, the site's
// own addresses, the anchors of items on its pages, dates and periods in words, and safe Markdown
// prose. Importable from client components; imports no other module.
export { Footer } from "./components/footer";
export { ProseMarkdown, proseComponents } from "./components/markdown";
export { anchorHref, anchorId, type AnchorTarget } from "./anchors";
export { formatDate, formatPeriod } from "./period";
export { routes } from "./site";
