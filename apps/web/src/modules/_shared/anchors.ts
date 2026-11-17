// The one anchor convention of the site (docs/design.md, Anchors): an item on a page is addressed by
// its kind and its stable slug, never by its position on the page.

/**
 * An item a link can point at. A case study is addressed by the slug of the project it explains,
 * because a project has at most one.
 */
export type AnchorTarget =
  | { readonly kind: "experience"; readonly slug: string }
  | { readonly kind: "project"; readonly slug: string }
  | { readonly kind: "case-study"; readonly project: string };

/** The item's id on its page: `experience-<slug>`, `project-<slug>` or `case-study-<project>`. */
export function anchorId(_target: AnchorTarget): string {
  throw new Error(`not implemented: ${JSON.stringify([_target])}`);
}

/** The address of the item on the page that shows it, for example `/experience#project-<slug>`. */
export function anchorHref(_target: AnchorTarget): string {
  throw new Error(`not implemented: ${JSON.stringify([_target])}`);
}
