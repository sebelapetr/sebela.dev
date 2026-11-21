# Code standards

Conventions in force since the phase 2 backend; change this document in the same pull request that changes a convention.

## TypeScript

- Strict mode everywhere. No `any`; use `unknown` and narrow it.
- Every `tsconfig.json` extends `@sebela/config/tsconfig.base.json`. Beyond `strict` it enables `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch` and `verbatimModuleSyntax`, and targets Node.js ESM (`module: nodenext`, ES2024). A package may add options for its runtime (for example a bundler for the website) but does not switch a check off.
- Prefer named exports. A package exposes its public interface from one entry file and nothing else is imported from outside the package.
- Types that cross a package boundary come from `@sebela/contracts`. Do not redefine them locally.
- Validate at the edges: everything entering the system (HTTP input, environment variables, tool arguments, seed files) is parsed with a Zod schema. Inside the system, trust the types.

## Structure

- Deep modules: a small, stable interface hiding a lot of behaviour. Prefer one module that does a job completely over several thin ones that pass data along.
- API controllers are thin: validate, call a service, return. No domain rules in controllers.
- Database access goes through repositories in `@sebela/db`. Services do not write SQL.
- Authentication is applied as middleware on the private route group in the API, not inside individual handlers.
- No environment access scattered through the code: each app reads and validates its environment once, at startup, and passes configuration down.

## Deep modules

### Why

A caller should learn one operation and its guarantees, rather than the internal sequence that makes it work. Information hiding keeps validation decisions, persistence details and failure handling with the code that owns them. Changing a storage driver or an internal query should not require edits in every caller.

This also gives a coding agent a useful reading path: app/package module map → public entry and documented contract → behaviour tests → implementation when needed. It limits the context needed to use a module; it is not a claim of measured improvements in model accuracy. Folder depth and implementation line counts do not measure module depth.

### How

- Start with the caller's complete operation, its inputs/result and the decisions it hides. Export cohesive operations such as updating an experience and its technology relations, validating/attaching media, or verifying a key. Do not make callers reconstruct the workflow from low-level steps.
- Document inputs, results, errors, side effects, atomicity, ordering and required configuration at the entry. Public types alone do not describe the complete contract. Keep external types/domain results stable while internals change.
- Use the explicit entries and placement rules in [repository structure](repository-structure.md#backend-module-layout); the website's modules follow its [web module layout](repository-structure.md#web-module-layout). Select exports deliberately; a barrel that re-exports every internal file is not encapsulation. Private files stay private even if TypeScript can resolve them.
- Compose validated configuration and resources once, then pass required capabilities to modules. Keep dependency direction acyclic. [Architecture](architecture.md#module-responsibilities-and-composition) assigns HTTP/security, domain orchestration and SQL to distinct owners.
- Keep SQL, Drizzle query builders/tables, transaction/connection handles, storage SDK objects and driver-specific errors inside their owning implementation. Db exposes atomic persistence operations; services request those operations without handling SQL primitives. The one exception is the caller-scoped unit of work `Persistence.transaction(work)`, which a services use case may use to apply many complete persistence operations as one (today only the seed load); it hands over persistence operations, never a transaction handle ([decision 0015](decisions/0015-caller-scoped-unit-of-work-for-the-seed.md)).
- Use replaceable drivers for actual variation, such as local/Bunny storage. Retain required HTTP, security and package adapters even with one implementation. Do not add speculative factories, generic repositories or a forwarding class per table. When deleting a proposed wrapper only deletes forwarding code, simplify it; when deleting it forces callers to recreate a workflow, it probably hides useful work.
- Verify observable results through the public operation and keep those tests through refactors. Nontrivial internal pure helpers may have focused tests without being exported solely for testing. Real persistence tests use real Postgres; follow [testing](testing.md#test-surfaces-and-the-redgreenrefactor-cycle).
- Add or change the module map alongside the implementation: module path, public entry, responsibility/hidden decisions, allowed dependencies and relevant test commands. Start with real functionality, not empty modules for later phases.

### Example: update an experience

The HTTP adapter authenticates and validates once, then calls a profile operation through its public entry:

```typescript
const result = await profile.updateExperience({
  id: experienceId,
  changes: { title: "Platform engineer", technologyIds },
});
```

The interface promises either a consistent updated experience/relations or a documented failure with no partial write. Services own domain checks; db owns the atomic persistence operation. The caller never obtains a transaction, updates the experience table, deletes join rows, inserts technology links and decides how to roll back. That sequence belongs behind db's interface; exposing it would make every caller understand the implementation. Even the seed's unit of work ([decision 0015](decisions/0015-caller-scoped-unit-of-work-for-the-seed.md)) only groups such complete operations; it never hands out the transaction. This example describes a future operation, not an existing runtime export.

### Enforcement and review

The `sebela/import-boundaries` lint rule enforces the import side of these instructions in every package's `lint` task and in CI. Since phase 1 it checks the package dependency table and declared package entries; since phase 2 ([issue #22](https://github.com/sebelapetr/sebela.dev/issues/22)) it also rejects imports of another module's private files, whether reached by a relative path, an alias or a declared package export, imports of tooling configurations from outside their tooling, and cycles between modules. Its behaviour, the tooling exception and its static-analysis limits are described in [repository structure](repository-structure.md#the-sebelaimport-boundaries-lint-rule). The reviewer still checks what import syntax cannot prove: information hiding, a cohesive interface whose guarantees and errors are documented at the entry, deliberately selected exports, and an up-to-date module map.

The conceptual references are [Ousterhout's modular design](https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=modularDesign) and [Matt Pocock's codebase-design](https://www.aihero.dev/skills-codebase-design). The directory convention, trust boundary and test policy are this repository's choices. Project-local skills record their upstream revision and adaptations; project terms such as API, service, repository and component retain their established meaning.

## Naming

- Files and folders: `kebab-case`. Types and components: `PascalCase`. Functions and variables: `camelCase`.
- Database tables and columns: `snake_case`. Table names are plural.
- Use the vocabulary of `docs/domain-context.md`. An experience is not a "job", an exploration is not a "side project".

## Errors

- Expected failures (not found, not allowed, invalid input) are part of a function's return type or mapped to a typed error the API turns into the right status code. They are not thrown as generic errors.
- Unexpected failures are thrown and handled once, at the edge of the app.
- Error responses of the API have one shape, defined in `@sebela/contracts`.

## Comments and documentation

- Comment why, not what. Code that needs a comment to explain what it does is rewritten first.
- No commented-out code.

## Formatting and lint

- Prettier formats; ESLint checks. Both run automatically on changed files: Prettier after every agent edit, both on the staged files of every commit, and lint with typecheck when a developer agent hands off (see [local checks](testing.md#local-checks)). CI checks the formatting of every tracked file (`pnpm check:format`).
- Prettier uses its defaults (double quotes, semicolons, trailing commas) with a print width of 100. The only Prettier configuration is the root `prettier.config.js`, which re-exports `@sebela/config/prettier`.
- Every package's `eslint.config.js` is `createConfig({ tsconfigRootDir: import.meta.dirname })` from `@sebela/config/eslint`, followed only by package-specific additions. TypeScript files are linted with `typescript-eslint`'s strict and stylistic type-checked rules; JavaScript files with ESLint's recommended rules. The root configuration lints the harness and root files; each package lints itself.
- `createConfig` also enables `sebela/import-boundaries` on every JavaScript and TypeScript file, so each package inherits the [dependency rules](repository-structure.md#dependency-rules) through its normal `lint` task.
- A lint rule is never disabled inline to make a check pass without the owner's approval. A disable directive that no longer suppresses anything is itself a lint error.

## Python

`apps/ai-service`, `apps/mcp-public` and `packages/llm-agent` use Python. The phase-6 toolchain is uv (dependencies/environments and a committed workspace lockfile), Ruff (formatting and lint, including import cleanup/sorting), mypy strict with `pydantic.mypy` (types), and pytest (deterministic tests). The versions are uv 0.7.22 (the lower bound CI installs), Python 3.13, Ruff 0.17.6, mypy 2.4.1 and pytest 9.2.0 ([Toolchain and workspace](repository-structure.md#toolchain-and-workspace)); no editor is required. Generated code (the content client) is excluded from Ruff and its bodies from mypy errors, while its signatures still type the handwritten callers. CI uses `uv sync --locked`, `ruff format --check`, `ruff check`, `mypy` with the strict project configuration, and `pytest`, exposed through pnpm/Turbo task wrappers. Separate autoflake, Flake8, isort, Black and a second required type checker are unnecessary. Use `src/llm_agent` as the library import root, responsibility folders and documented public entries; keep runtime/HTTP lifecycle in apps. The same principles apply: validate at the edges, thin handlers, no environment access scattered through the code, no hard-coded endpoints.

## Dependencies

- Adding a dependency needs a reason stated in the pull request. Prefer what is already in the repository.
- Shared tool configuration lives in `@sebela/config`.
- Versions of tools used by more than one package are pinned once in the `catalog` of `pnpm-workspace.yaml` and referenced with `catalog:`. Workspace packages depend on each other with `workspace:*`.
- The lockfile is committed and CI installs with `--frozen-lockfile`. See [repository structure](repository-structure.md#toolchain-and-workspace) for the supported Node.js and pnpm versions.
