// The shared module: what the website's modules and routes have in common — the footer, the CV's
// actions (the PDF's download and date, the live CV), the site's own addresses, the anchors of
// items on its pages, the career's length in years, an exploration's status and an experience's kind in words, the education
// records as rows, dates and periods in words, and safe Markdown prose. Importable from client
// components; imports no other module.
export { CvActions } from "./components/cv-actions";
export { Footer } from "./components/footer";
export { ProseMarkdown, proseComponents } from "./components/markdown";
export { careerYears } from "./career";
export { anchorHref, anchorId, type AnchorTarget } from "./anchors";
export { toEducationRows, type EducationRow } from "./education";
export { experienceKindLabel } from "./experience-kind";
export { explorationStatusText, type ExplorationStatusText } from "./exploration-status";
export { formatDate, formatPeriod } from "./period";
export { cvPdfRoutes, routes } from "./site";
