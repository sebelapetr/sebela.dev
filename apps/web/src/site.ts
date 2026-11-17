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
