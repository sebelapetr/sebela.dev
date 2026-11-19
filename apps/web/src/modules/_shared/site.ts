// Addresses of the site itself. Public project metadata only: personal facts and contact values
// come from the API, never from here.

/** The public repository of this website. */
export const repositoryUrl = "https://github.com/sebelapetr/sebela.dev";

/** The site's own pages, as later slices deliver them. */
export const routes = {
  home: "/",
  services: "/services",
  experience: "/experience",
  cv: "/cv",
  /** The AI Engineering Roadmap overview; its areas and sections live below it. */
  aiRoadmap: "/ai-roadmap",
  contact: "/#contact",
  /** The chat; a conversation is `/ask?c=<id>` (the chat module builds it). */
  ask: "/ask",
} as const;

/** The AI Engineering Roadmap's own pages below the overview, besides its areas, modules and books. */
export const roadmapRoutes = {
  diary: `${routes.aiRoadmap}/diary`,
  statistics: `${routes.aiRoadmap}/diary/stats`,
  events: `${routes.aiRoadmap}/events`,
  bookshelf: `${routes.aiRoadmap}/bookshelf`,
  readingGuide: `${routes.aiRoadmap}/how-to-read-effectively`,
} as const;

/** The CV PDF's addresses: a download and its failure page, not pages of the site to link to. */
export const cvPdfRoutes = {
  /** The current CV PDF as a download; without one, a redirect to the CV page. */
  download: "/cv/pdf",
  /** Where a CV PDF download that failed ends up. */
  unavailable: "/cv/pdf/unavailable",
} as const;
