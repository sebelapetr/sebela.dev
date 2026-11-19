// The one anchor convention of the site (docs/design.md, Anchors): an item on a page is addressed by
// its kind and its stable slug, never by its position on the page.
import { routes } from "./site";

/**
 * An item a link can point at. A case study is addressed by the slug of the project it explains,
 * because a project has at most one; a technology group by its group, of which there are three;
 * the independent R&D block is one section of the page. A service is on the services page; every
 * other item is on the experience page. A roadmap resource is on its module's own page, addressed by
 * the area and the module it belongs to.
 */
export type AnchorTarget =
  | { readonly kind: "experience"; readonly slug: string }
  | { readonly kind: "project"; readonly slug: string }
  | { readonly kind: "case-study"; readonly project: string }
  | { readonly kind: "exploration"; readonly slug: string }
  | {
      readonly kind: "technology-group";
      readonly group: "core" | "ai-engineering-focus" | "secondary";
    }
  | { readonly kind: "independent-rd" }
  | { readonly kind: "service"; readonly slug: string }
  | {
      readonly kind: "roadmap-resource";
      readonly area: string;
      readonly module: string;
      readonly slug: string;
    };

/**
 * The item's id on its page: `experience-<slug>`, `project-<slug>`, `case-study-<project>`,
 * `exploration-<slug>`, `technology-group-<group>`, `independent-rd`, `service-<slug>` or
 * `resource-<slug>`.
 */
export function anchorId(target: AnchorTarget): string {
  switch (target.kind) {
    case "experience":
      return `experience-${target.slug}`;
    case "project":
      return `project-${target.slug}`;
    case "case-study":
      return `case-study-${target.project}`;
    case "exploration":
      return `exploration-${target.slug}`;
    case "technology-group":
      return `technology-group-${target.group}`;
    case "independent-rd":
      return "independent-rd";
    case "service":
      return `service-${target.slug}`;
    case "roadmap-resource":
      return `resource-${target.slug}`;
  }
}

/**
 * The address of the item on the page that shows it, for example `/experience#project-<slug>`,
 * `/services#service-<slug>` or `/ai-roadmap/<area>/<module>#resource-<slug>`.
 */
export function anchorHref(target: AnchorTarget): string {
  return `${pageOf(target)}#${anchorId(target)}`;
}

function pageOf(target: AnchorTarget): string {
  switch (target.kind) {
    case "service":
      return routes.services;
    case "roadmap-resource":
      return roadmapHref({ area: target.area, module: target.module });
    default:
      return routes.experience;
  }
}

/** An AI Roadmap container with its own page: an area, or a module within its area. */
export interface RoadmapPageTarget {
  readonly area: string;
  readonly module?: string;
}

/**
 * The address of an area's page, `/ai-roadmap/<area>`, or a module's page,
 * `/ai-roadmap/<area>/<module>`. Each slug stays inside its own path segment.
 */
export function roadmapHref(target: RoadmapPageTarget): string {
  const area = `${routes.aiRoadmap}/${encodeURIComponent(target.area)}`;
  return target.module === undefined ? area : `${area}/${encodeURIComponent(target.module)}`;
}

/**
 * The address of the bookshelf, `/ai-roadmap/bookshelf`, or of a book's page on it,
 * `/ai-roadmap/bookshelf/<book>`. The book's slug stays inside its own path segment.
 */
export function bookshelfHref(book?: string): string {
  const shelf = `${routes.aiRoadmap}/bookshelf`;
  return book === undefined ? shelf : `${shelf}/${encodeURIComponent(book)}`;
}

/**
 * The address of the learning diary, `/ai-roadmap/diary`, or of a day's page on it,
 * `/ai-roadmap/diary/<date>`. The date stays inside its own path segment.
 */
export function diaryHref(date?: string): string {
  throw new Error("not implemented", { cause: date });
}
