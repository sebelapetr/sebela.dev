/** The longest title, so a search result shows it whole. */
export const TITLE_MAX = 60;

export function pageTitle(site: string, page: string, ...context: readonly string[]): string {
  throw new Error("not implemented", { cause: [site, page, context] });
}

export function homepageTitle(name: string, headline: string): string {
  throw new Error("not implemented", { cause: [name, headline] });
}
