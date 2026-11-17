# @sebela/web

The public website: a Next.js app (App Router) that renders its content from the API's public routes. Read the root `AGENTS.md` first; this file covers only what is specific to this app. Visual language: `docs/design.md` (binding).

## What it is

- The website reaches data only through the API over HTTP, with the generated `@sebela/api-client`, from server code. It never imports `@sebela/db` or `@sebela/services` (the import-boundaries lint rule enforces this) and never holds an API key: it reads public routes only.
- Every fact about the person — name, headline, bio, photo, email address, links — comes from the API. Components carry only UI copy: labels, headings and the site's own addresses (`src/site.ts`). No experience years, employer names or contact values are written into the app.
- Pages render on each request (`connection()`), so the build needs no API and no settings. Caching (#56, #57), image optimisation (#55), the theme toggle and navigation (#50) and the chat (#51) belong to later issues.
- Tokens, fonts and shared components come from `@sebela/ui` through its declared exports (`packages/ui/AGENTS.md`).

## Commands

| Task                                                | Command                                       |
| --------------------------------------------------- | --------------------------------------------- |
| Development server on this checkout's address       | `pnpm --filter @sebela/web dev`               |
| Build (no API or settings needed)                   | `pnpm --filter @sebela/web build`             |
| Serve the build                                     | `pnpm --filter @sebela/web start`             |
| Unit tests (Vitest)                                 | `pnpm --filter @sebela/web test`              |
| Browser tests against a real API (build first)      | `pnpm --filter @sebela/web test:e2e`          |
| Browser tests with every build they need (as in CI) | `pnpm test:e2e` (from the repository root)    |
| Lint, typecheck (`next typegen`, then `tsc`)        | `pnpm --filter @sebela/web lint`, `typecheck` |

`dev`, `start` and `test:e2e` read the process environment, then `.env.local`, `.env` and `.env.example` of the checkout (the earlier source wins). `dev` and `start` go through `scripts/next.mjs`, which passes `WEB_HOST` and `WEB_PORT` to Next and refuses to start without them. `dev` first builds the workspace packages the app depends on. For a browser read in development, run the API of the same checkout (`pnpm --filter @sebela/api dev`) and then `dev`.

## Configuration

| Variable           | Meaning                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WEB_HOST`         | Interface the website listens on (`dev`, `start`).                                                                                                                                                                                                                                                                                                                                                       |
| `WEB_PORT`         | Port the website listens on; the port scheme of `docs/repository-structure.md`.                                                                                                                                                                                                                                                                                                                          |
| `WEB_API_BASE_URL` | Base address of the API whose public routes the website reads: its origin, or an origin with a path prefix in front of `/v1`. Validated once per process by `readWebConfig` on the first content request: an `http` or `https` address without credentials, query or fragment; the error names the variable, never its value. Worktree setup writes the worktree's own API origin into its `.env.local`. |

The build reads none of them. A missing or invalid `WEB_API_BASE_URL` fails the first request that needs content, not the build. A worktree created before the harness wrote `WEB_API_BASE_URL` (commit `e2db9b4`) has no value for it: add `WEB_API_BASE_URL=http://<its API_HOST>:<its API_PORT>` to its `.env.local`, or recreate the worktree.

## Content states

`getHomepage()` reads `GET /v1/person` and, when the person has a photo, `GET /v1/media/{id}`, uncached (`no-store`) and within 5 seconds each, once per request however many components ask.

- **Ready.** The homepage renders the hero (name, headline, short bio as inline Markdown, photo, the calls to action "Work with me" to `/services` for clients and "View my experience" to `/experience` for employers), the contact block (`#contact`, the email address and the person's web links) and the footer (repository and CV).
- **Missing.** The API answers 404: no profile is published, and the page answers 404 (`not-found.tsx`).
- **Unavailable.** The API fails, is unreachable or too slow: `error.tsx` says the content is unavailable and offers "Try again" (HTTP 500). The website never shows an empty profile in its place.
- A photo that cannot be shown (not an image, no address, no dimensions, a failed read) leaves the profile without one: the portrait shows the initials instead. Links that are not `http` or `https` are left out; the short bio renders only paragraphs, emphasis, code and links, never raw HTML.

The destination pages (`/services`, `/experience`, `/cv`) arrive with later slices; their links are already correct.

## Dependencies and why

| Dependency                                                 | Why                                                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `next`, `react`, `react-dom` (catalog)                     | The agreed frontend framework (overview PRD, phase 3). Next 16 with the App Router; server components read the API so no key or address reaches the browser.       |
| `@sebela/api-client`, `@sebela/ui`                         | The typed public API client and the shared tokens, fonts and components.                                                                                           |
| `zod` (catalog)                                            | Validates the environment once, as the API does.                                                                                                                   |
| `react-markdown`                                           | Profile texts are Markdown. It renders to React elements without raw HTML and drops unsafe link protocols, so no sanitiser or `dangerouslySetInnerHTML` is needed. |
| `lucide-react` (catalog)                                   | The agreed icon set (`docs/design.md`).                                                                                                                            |
| `server-only`                                              | Fails the build if the API-reading profile module is imported into client code.                                                                                    |
| `tailwindcss` (catalog), `@tailwindcss/postcss`, `postcss` | Tailwind CSS v4 through its PostCSS plugin, the setup Next documents for Tailwind v4.                                                                              |
| `@next/eslint-plugin-next`, `eslint-plugin-react-hooks`    | Next's and React's lint rules on top of the shared configuration. `eslint-config-next` is not used: it does not support ESLint 10 yet.                             |
| `@playwright/test`, `@axe-core/playwright`                 | Browser tests and automated accessibility checks (`docs/testing.md`).                                                                                              |
| `vitest` (catalog)                                         | Unit tests of the configuration and the content mapping.                                                                                                           |

## Module map

Not a backend module layout: an App Router app keeps its native placement (`src/app/`), and the modules beside it are entered through their `index`.

| Module / file                 | Responsibility                                                                                                                                                                                                                                                                                  | Tests                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `src/config.ts`               | `readWebConfig(env)`: validates `WEB_API_BASE_URL` and names every problem without values.                                                                                                                                                                                                      | `src/config.test.ts`                        |
| `src/profile/` (`index.ts`)   | Server-only read of the public profile: `getHomepage()` (one read per request, client created after one validation) returning `ready`, `missing` or `unavailable`; `load-homepage.ts` maps the API's person and media to `HomepageProfile` (photo, `mailto:` address, web links) with timeouts. | `src/profile/load-homepage.test.ts`; `e2e/` |
| `src/homepage/` (`index.tsx`) | `Homepage`: hero, portrait with initials fallback, inline Markdown and contact block, rendered from a `HomepageProfile`.                                                                                                                                                                        | `e2e/homepage.spec.ts`                      |
| `src/footer.tsx`              | The footer: copyright with the name from the API (or none), the repository and the CV. Shared by the homepage and `error.tsx`.                                                                                                                                                                  | `e2e/homepage.spec.ts`                      |
| `src/site.ts`                 | The site's own addresses: the public repository and its routes. No personal facts.                                                                                                                                                                                                              | through the pages                           |
| `src/app/`                    | Next routes: the root layout (fonts, global styles), the homepage with its metadata, the unavailable state (`error.tsx`) and the missing state (`not-found.tsx`).                                                                                                                               | `e2e/homepage.spec.ts`                      |
| `scripts/next.mjs`            | Starts `next dev` or `next start` on `WEB_HOST` and `WEB_PORT`.                                                                                                                                                                                                                                 | through `test:e2e`                          |
| `e2e/`                        | Browser tests, their process helpers (`stack.ts`, which starts the API's `src/cli/e2e-server.ts` by its file path, the documented interface in `apps/api/AGENTS.md`) and fictional seed fixtures (`fixtures/with-photo`, `fixtures/without-photo`).                                             | —                                           |

## Tests

- **Unit** (`pnpm --filter @sebela/web test`): the configuration and the content mapping through the real generated client over a fake `fetch` — ready, missing, unavailable (server error, rate limit, a proxy's 502, no connection, timeout), only public routes without credentials or cache, the photo cases and the contact values. Written before the implementation.
- **End-to-end tests** (`test:e2e`, Playwright, Chromium): the built website against the API's end-to-end server (`apps/api`, `src/cli/e2e-server.ts`), a real API on a temporary database of its own, seeded from a small fictional fixture and dropped afterwards; the checkout's database and the demo seed are never touched. They check the content and its links, the contact anchor, keyboard order and visible focus, axe violations, touch targets of at least 44 px and no horizontal scroll at 360, 768 and 1280 px in light and dark mode, the initials fallback without a photo or email, and the unavailable state with a working retry. Screenshots of each width and mode go to `test-results/`.
- The main stack listens on this checkout's own `API_PORT` and `WEB_PORT`, so stop the checkout's dev servers first; the other stacks take free ports from the system. Run `pnpm --filter @sebela/web build` before `test:e2e`, or use the root `pnpm test:e2e`, which builds the website and the API first. They need the running Postgres and the checkout's `DATABASE_USER`/`DATABASE_PASSWORD`, and Chromium (`pnpm --filter @sebela/web exec playwright install chromium`).
