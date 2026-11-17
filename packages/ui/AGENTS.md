# @sebela/ui

The shared visual base of the website: design tokens, fonts and React components (Tailwind CSS v4, shadcn/ui in the `base-nova` style on Base UI, Geist and Geist Mono, Lucide icons). Read the root `AGENTS.md` first; this file covers only what is specific to this package. The visual language is `docs/design.md` (binding).

## What it is

- A source package without a build step: it ships TypeScript and CSS, and the consuming Next app compiles it (`transpilePackages: ["@sebela/ui"]` in `apps/web/next.config.ts`), as shadcn's monorepo setup does. It has `lint` and `typecheck`, no `build` or tests of its own.
- It imports only `@sebela/config` from the workspace (dependency table in `docs/repository-structure.md`; the import-boundaries lint rule enforces it). It knows nothing about the API, content or the person.
- The tokens of `docs/design.md` are defined here once, light by default and dark through `prefers-color-scheme`; components use them through Tailwind utilities and never raw colour values. The explicit theme toggle is #50.

## Public interface

Only the declared `exports` of `package.json` are public. Inside the package, files use the private `#components/*` and `#lib/*` imports.

| Export                         | What it provides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@sebela/ui/globals.css`       | The global stylesheet: imports Tailwind, scans this package's sources, defines the colour tokens, radius and font families as Tailwind theme variables and the base body styles. Import it once in the root layout; the app's own sources are detected by Tailwind.                                                                                                                                                                                                                                                                     |
| `@sebela/ui/fonts`             | `fontSans` (Geist) and `fontMono` (Geist Mono) from the `geist` package, self-hosted through `next/font`. Put both `variable` class names on the `<html>` element.                                                                                                                                                                                                                                                                                                                                                                      |
| `@sebela/ui/components/<name>` | Components, one file each. Now: `button` (`Button`, `buttonVariants` for links styled as buttons), with sizes of at least 44 px. `buttonVariants` returns the base and variant classes unmerged (the base's `border-transparent` and `text-sm` beside a variant's border colour or a size's text size), so wrap it in `cn` from `@sebela/ui/lib/utils`, as `Button` does. `timeline` (`Timeline`, `TimelineItem`, `TimelineTrigger`, `TimelineContent`): a content-agnostic vertical timeline of disclosure items (see Timeline below). |
| `@sebela/ui/lib/utils`         | `cn(...classes)`: joins class names and resolves conflicting Tailwind utilities.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Adding a component

Take shadcn components from the registry of the `base-nova` style. The shadcn CLI is not a dependency; run in this folder, it reads `components.json` (style `base-nova`, base colour `neutral`, CSS variables, Lucide, the `#components` and `#lib` aliases). Then adapt it to `docs/design.md` (touch targets, only the defined tokens), keep only what is used, note the changes in the file's header comment and add the file to the module map. A new export pattern is a change to `package.json` `exports` and this file.

## Timeline

`@sebela/ui/components/timeline` is not a shadcn registry component; it is built here on Base UI's Collapsible with the look of `docs/design.md` (Timeline). It knows nothing about what its items contain: the experience page and, later, the AI Engineering Roadmap fill it with their own content.

- `Timeline`: an `<ol>` with the dashed rail. Takes the props of `<ol>`.
- `TimelineItem`: one `<li>` and its disclosure state. `id` is the item's anchor; `defaultOpen` sets the first state; `open` with `onOpenChange(open)` controls it from outside (a deep link that opens an item). Nothing else.
- `TimelineTrigger`: the real `<button>` that opens and closes the item, with the marker on the rail, a hover state and a visible focus ring; at least 44 px tall. Put it in a heading of the right level (`<h3><TimelineTrigger>…</TimelineTrigger></h3>`); its children are phrasing content.
- `TimelineContent`: a region named by the trigger. Closed content stays in the page as `hidden="until-found"`, so the browser's page search finds it and opens the item.
- Nesting is composition: a `Timeline` inside a `TimelineContent`. There are no variants.

## Dependencies and why

| Dependency                                           | Why                                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `@base-ui/react`                                     | The headless primitives the `base-nova` style is built on (`docs/design.md`).                 |
| `class-variance-authority`, `clsx`, `tailwind-merge` | What shadcn components use for variants and class merging (`cn`).                             |
| `geist`                                              | Geist and Geist Mono, self-hosted through `next/font`, so no request goes to a font service.  |
| `lucide-react` (catalog)                             | The agreed icon set, shared with the website through the catalog.                             |
| `next`, `react`, `react-dom`, `tailwindcss` (peer)   | Provided by the consuming app; installed here as development dependencies only for typecheck. |

## Module map

Not a backend module layout: shadcn components keep their native placement.

| File                          | Responsibility                                              | Tests                                                            |
| ----------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/styles/globals.css`      | Tokens (light, dark), theme variables, base styles.         | screenshots of `apps/web` (`e2e/`)                               |
| `src/fonts.ts`                | The font exports.                                           | `apps/web` build and screenshots                                 |
| `src/components/button.tsx`   | `Button` and `buttonVariants`.                              | `apps/web/e2e/homepage.spec.ts` (focus, size, axe)               |
| `src/components/timeline.tsx` | The shared timeline: rail, markers, disclosure, open state. | `apps/web/e2e/experience.spec.ts` (keyboard, anchors, axe, size) |
| `src/lib/utils.ts`            | `cn`.                                                       | through the components                                           |
| `components.json`             | shadcn CLI configuration (style, aliases, icon library).    | —                                                                |
