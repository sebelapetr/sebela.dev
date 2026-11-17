// The one anchor convention of the site (docs/design.md, Anchors): an item on a page is addressed by
// its kind and its stable slug, never by its position on the page.
import { routes } from "./site";

/**
 * An item a link can point at. A case study is addressed by the slug of the project it explains,
 * because a project has at most one; a technology group by its group, of which there are three;
 * the independent R&D block is one section of the page.
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
  | { readonly kind: "independent-rd" };

/**
 * The item's id on its page: `experience-<slug>`, `project-<slug>`, `case-study-<project>`,
 * `exploration-<slug>`, `technology-group-<group>` or `independent-rd`.
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
  }
}

/** The address of the item on the page that shows it, for example `/experience#project-<slug>`. */
export function anchorHref(target: AnchorTarget): string {
  return `${routes.experience}#${anchorId(target)}`;
}
