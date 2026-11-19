// The site's main pages search engines may index, with their addresses and their names in titles
// and on their preview images. The AI Roadmap's pages are indexed too, from their own reads
// (`roadmap-discovery.ts`, `roadmap-page.ts`).
import { routes } from "../../_shared";

/** The site's main pages, each with its preview image at `/og/<page>`. */
export type IndexedPage = "home" | "experience" | "services" | "cv";

export const PAGES: Readonly<
  Record<IndexedPage, { readonly path: string; readonly label: string | null }>
> = {
  home: { path: routes.home, label: null },
  experience: { path: routes.experience, label: "Experience" },
  services: { path: routes.services, label: "Services" },
  cv: { path: routes.cv, label: "CV" },
};

/** Whether a value names an indexed page; only its own keys, never an inherited property. */
export function isIndexedPage(value: string): value is IndexedPage {
  return Object.hasOwn(PAGES, value);
}
