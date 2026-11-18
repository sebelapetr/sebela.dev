import type { RoadmapArea, RoadmapTreeArea, RoadmapTreeModule } from "@sebela/api-client";

import type { AreaRow, ModuleRow, ResourceRow } from "./overview";

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

export function toRoadmapAreaPage(_area: RoadmapTreeArea): RoadmapAreaPage {
  throw new Error("not implemented", { cause: _area });
}

export function toRoadmapModulePage(
  _area: RoadmapArea,
  _module: RoadmapTreeModule,
): RoadmapModulePage {
  throw new Error("not implemented", { cause: [_area, _module] });
}
