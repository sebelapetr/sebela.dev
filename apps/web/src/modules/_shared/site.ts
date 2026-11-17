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
  /** The current CV PDF as a download (`/cv/pdf`); without one, a redirect to the CV page. */
  cvPdf: "/cv/pdf",
  /** Where a CV PDF download that failed ends up. */
  cvPdfUnavailable: "/cv/pdf/unavailable",
  contact: "/#contact",
} as const;
