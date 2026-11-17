# @sebela/ui

The shared visual base of the website: design tokens, fonts and React components (Tailwind CSS v4, shadcn/ui in the `base-nova` style on Base UI, Geist and Geist Mono, Lucide icons). Read the root `AGENTS.md` first; this file covers only what is specific to this package. The visual language is `docs/design.md` (binding).

## What it is

- A source package without a build step: it ships TypeScript and CSS, and the consuming Next app compiles it (`transpilePackages: ["@sebela/ui"]` in `apps/web/next.config.ts`), as shadcn's monorepo setup does. It has `lint` and `typecheck`, no `build` or tests of its own.
- It imports only `@sebela/config` from the workspace (dependency table in `docs/repository-structure.md`; the import-boundaries lint rule enforces it). It knows nothing about the API, content or the person.
- The tokens of `docs/design.md` are defined here once, light by default and dark through `prefers-color-scheme`; components use them through Tailwind utilities and never raw colour values. The explicit theme toggle is #50.

## Public interface

Only the declared `exports` of `package.json` are public. Inside the package, files use the private `#components/*` and `#lib/*` imports.

| Export                         | What it provides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@sebela/ui/globals.css`       | The global stylesheet: imports Tailwind, scans this package's sources, defines the colour tokens, radius and font families as Tailwind theme variables, the type-scale utilities (`type-display`, `type-title`, `type-heading`, `type-lead`, `type-label`), the page frame (`layout-page`), the base body styles, the default focus outline and the reduced-motion rule (`docs/design.md`, Typography, Spacing, Focus, Motion). Import it once in the root layout; the app's own sources are detected by Tailwind. |
| `@sebela/ui/fonts`             | `fontSans` (Geist) and `fontMono` (Geist Mono) from the `geist` package, self-hosted through `next/font`. Put both `variable` class names on the `<html>` element.                                                                                                                                                                                                                                                                                                                                                 |
| `@sebela/ui/components/<name>` | shadcn components, one file each. Now: `button` (`Button`, `buttonVariants` for links styled as buttons), with sizes of at least 44 px. `buttonVariants` returns the base and variant classes unmerged (the base's `border-transparent` and `text-sm` beside a variant's border colour or a size's text size), so wrap it in `cn` from `@sebela/ui/lib/utils`, as `Button` does.                                                                                                                                   |
| `@sebela/ui/lib/utils`         | `cn(...classes)`: joins class names and resolves conflicting Tailwind utilities.                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Adding a component

Take shadcn components from the registry of the `base-nova` style. The shadcn CLI is not a dependency; run in this folder, it reads `components.json` (style `base-nova`, base colour `neutral`, CSS variables, Lucide, the `#components` and `#lib` aliases). Then adapt it to `docs/design.md` (touch targets, only the defined tokens), keep only what is used, note the changes in the file's header comment and add the file to the module map. A new export pattern is a change to `package.json` `exports` and this file.

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

| File                        | Responsibility                                                                                        | Tests                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `src/styles/globals.css`    | Tokens (light, dark), theme variables, type and frame utilities, base styles (focus, reduced motion). | screenshots of `apps/web` (`e2e/`)                 |
| `src/fonts.ts`              | The font exports.                                                                                     | `apps/web` build and screenshots                   |
| `src/components/button.tsx` | `Button` and `buttonVariants`.                                                                        | `apps/web/e2e/homepage.spec.ts` (focus, size, axe) |
| `src/lib/utils.ts`          | `cn`.                                                                                                 | through the components                             |
| `components.json`           | shadcn CLI configuration (style, aliases, icon library).                                              | —                                                  |
