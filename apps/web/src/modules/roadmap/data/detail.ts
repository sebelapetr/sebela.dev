import type { RoadmapArea, RoadmapTreeArea, RoadmapTreeModule } from "@sebela/api-client";

import { anchorId } from "../../_shared";
import {
  areaFields,
  areaHref,
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
 * numbered by the API's order and linking to their pages, the API's planned estimate for the whole
 * area and the way from the overview. Progress, status and estimates are the API's derived values.
 */
export function toRoadmapAreaPage(area: RoadmapTreeArea): RoadmapAreaPage {
  const row = areaFields(area);
  return {
    ...row,
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
