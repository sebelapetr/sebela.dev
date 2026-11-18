// The shared module: what the website's modules and routes have in common — the site header (the
// navigation, its mobile menu, the skip link and the theme toggle) and the id of the `<main>` it
// skips to, the theme's pre-paint script, the footer, the CV's actions (the PDF's download and
// date, the live CV), the site's own addresses, the anchors of items on its pages, the career's
// length in years, an exploration's status and an experience's kind in words, the technology
// groups, mailto links, Markdown as plain text, the education records as rows, dates and periods in words, and safe
// Markdown prose. Importable from client components; imports no other module.
export { CvActions } from "./components/cv-actions";
export { Footer } from "./components/footer";
export { SiteHeader } from "./components/site-header";
export { ProseMarkdown, proseComponents } from "./components/markdown";
export { careerYears } from "./career";
export { anchorHref, anchorId, type AnchorTarget } from "./anchors";
export { toEducationRows, type EducationRow } from "./education";
export { experienceKindLabel } from "./experience-kind";
export { explorationStatusText, type ExplorationStatusText } from "./exploration-status";
export { formatDate, formatPeriod } from "./period";
export { mailtoHref } from "./mailto";
export { plainText } from "./plain-text";
export { mainContentId } from "./navigation";
export { cvPdfRoutes, routes } from "./site";
export {
  TECHNOLOGY_GROUP_KEYS,
  technologyGroupLabel,
  technologyGroupOf,
  type TechnologyGroupKey,
} from "./technology-group";
export { themeScript } from "./theme";
