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
  contact: "/#contact",
} as const;

/** The CV PDF's addresses: a download and its failure page, not pages of the site to link to. */
export const cvPdfRoutes = {
  /** The current CV PDF as a download; without one, a redirect to the CV page. */
  download: "/cv/pdf",
  /** Where a CV PDF download that failed ends up. */
  unavailable: "/cv/pdf/unavailable",
} as const;
