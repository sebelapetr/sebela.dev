import type { IndexedPage, PageFacts } from "./page-metadata";

export interface OpenGraphCard {
  readonly site: string;
  readonly label: string | null;
  readonly title: string;
  readonly subtitle: string | null;
}

export function isPreviewPage(value: string): value is IndexedPage {
  throw new Error(`Not implemented: ${value}`);
}

export function openGraphImageUrl(origin: string, page: IndexedPage): string {
  throw new Error(`Not implemented: ${origin} ${page}`);
}

export function openGraphCard(
  origin: string,
  page: IndexedPage,
  facts: PageFacts | null,
): OpenGraphCard {
  throw new Error(`Not implemented: ${origin} ${page} ${facts?.name ?? ""}`);
}
