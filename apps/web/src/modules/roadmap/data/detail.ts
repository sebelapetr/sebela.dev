import type { RoadmapArea, RoadmapTreeArea, RoadmapTreeModule } from "@sebela/api-client";

import { anchorId } from "../../_shared";
import type { RoadmapAreaContent, RoadmapModuleContent } from "../../profile";
import {
  areaFields,
  areaHref,
  formatLastUpdated,
  moduleFields,
  plannedEstimate,
  ROADMAP_PATH,
  toResourceRow,
  type AreaRow,
  type ModuleRow,
  type ResourceRow,
} from "./overview";

/** One step of the way from the roadmap's overview to a page: its name and address. */
export interface RoadmapCrumb {
  readonly name: string;
  readonly href: string;
}

/** An area's own page: the area as the overview shows it, its estimate and the way to it. */
export interface RoadmapAreaPage extends Omit<AreaRow, "order"> {
  /** When the area last changed, as the API derived it (`March 14, 2026`), or null. */
  readonly updated: string | null;
  /** The area before this one in the roadmap's order, or null for the first. */
  readonly previous: RoadmapCrumb | null;
  /** The area after this one in the roadmap's order, or null for the last. */
  readonly next: RoadmapCrumb | null;
  /** The API's planned effort for the whole area, or null when nothing is estimated. */
  readonly estimate: string | null;
  /** The overview, then the area itself (the current page, last). */
  readonly breadcrumbs: readonly RoadmapCrumb[];
}

/** A resource on its module's page, with the id its source links land on. */
export interface RoadmapResourceEntry extends ResourceRow {
  readonly anchor: string;
}

/** A module's own page: the module, its area, its resources and the way to it. */
export interface RoadmapModulePage extends Omit<ModuleRow, "order" | "resources"> {
  /** When the module last changed, as the API derived it (`March 14, 2026`), or null. */
  readonly updated: string | null;
  readonly area: { readonly slug: string; readonly name: string; readonly href: string };
  readonly current: boolean;
  readonly resources: readonly RoadmapResourceEntry[];
  /** The overview, the area, then the module itself (the current page, last). */
  readonly breadcrumbs: readonly RoadmapCrumb[];
}

/** The overview's own crumb, first on every roadmap page's way. */
const OVERVIEW_CRUMB: RoadmapCrumb = { name: "AI Engineering Roadmap", href: ROADMAP_PATH };

/**
 * An area's own page from the API's area read: the area as the overview lists it, its modules
 * numbered by the API's order with their resources and linking to their pages, the API's planned
 * estimate for the whole area, when it last changed, the way from the overview and the areas before
 * and after it in `areas` (the roadmap's areas in the API's order; none when they do not hold it).
 * Progress, status, estimates and the last change are the API's derived values.
 */
export function toRoadmapAreaPage(
  area: RoadmapTreeArea,
  areas: readonly { readonly slug: string; readonly name: string }[] = [],
): RoadmapAreaPage {
  const row = areaFields(area);
  return {
    ...row,
    updated: lastUpdated(area.progress.lastUpdatedAt),
    ...neighbours(area.slug, areas),
    estimate: plannedEstimate(area.progress.estimatedMinutes),
    breadcrumbs: [OVERVIEW_CRUMB, { name: area.name, href: row.href }],
  };
}

/**
 * A module's own page from the API's module read: the module with its area, its resources in the
 * API's order, each with the anchor a source link lands on, and the way from the overview through
 * the area. Progress, status and estimates are the API's derived values.
 */
export function toRoadmapModulePage(
  area: RoadmapArea,
  module: RoadmapTreeModule,
): RoadmapModulePage {
  const row = moduleFields(area.slug, module);
  const areaLink = { slug: area.slug, name: area.name, href: areaHref(area.slug) };
  return {
    ...row,
    area: areaLink,
    updated: lastUpdated(module.progress.lastUpdatedAt),
    current: module.progress.status === "in-progress",
    resources: module.resources.map((resource) => ({
      ...toResourceRow(resource),
      anchor: anchorId({
        kind: "roadmap-resource",
        area: area.slug,
        module: module.slug,
        slug: resource.slug,
      }),
    })),
    breadcrumbs: [
      OVERVIEW_CRUMB,
      { name: areaLink.name, href: areaLink.href },
      { name: module.name, href: row.href },
    ],
  };
}

/** What an area's or a module's page metadata rests on, all of it from the page's API read. */
export interface RoadmapPageFacts {
  /** The person's name. */
  readonly name: string;
  readonly kind: "area" | "module";
  /** The overview, then the page's way down to the page itself (last). */
  readonly breadcrumbs: readonly RoadmapCrumb[];
  /** The page's Markdown description, or null. */
  readonly summary: string | null;
  /** The API's planned effort for the page's content in minutes; 0 when nothing is estimated. */
  readonly estimatedMinutes: number;
}

/** The facts an area's or a module's page metadata, structured data and preview image rest on. */
export function roadmapPageFacts(
  content: RoadmapAreaContent | RoadmapModuleContent,
): RoadmapPageFacts {
  if ("module" in content) {
    const page = toRoadmapModulePage(content.area, content.module);
    return {
      name: content.name,
      kind: "module",
      breadcrumbs: page.breadcrumbs,
      summary: page.description,
      estimatedMinutes: content.module.progress.estimatedMinutes,
    };
  }
  const page = toRoadmapAreaPage(content.area);
  return {
    name: content.name,
    kind: "area",
    breadcrumbs: page.breadcrumbs,
    summary: page.description,
    estimatedMinutes: content.area.progress.estimatedMinutes,
  };
}

function lastUpdated(iso: string | null): string | null {
  return iso === null ? null : formatLastUpdated(iso);
}

/** The areas before and after `slug` in `areas`; none when `areas` do not hold it. */
function neighbours(
  slug: string,
  areas: readonly { readonly slug: string; readonly name: string }[],
): { readonly previous: RoadmapCrumb | null; readonly next: RoadmapCrumb | null } {
  const index = areas.findIndex((area) => area.slug === slug);
  if (index === -1) return { previous: null, next: null };
  const link = (area: { readonly slug: string; readonly name: string } | undefined) =>
    area === undefined ? null : { name: area.name, href: areaHref(area.slug) };
  return { previous: link(areas[index - 1]), next: link(areas[index + 1]) };
}
