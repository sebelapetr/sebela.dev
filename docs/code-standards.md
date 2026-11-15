# Code standards

Initial conventions. They are refined in phase 2, when the first real code exists; change this document in the same pull request that changes a convention.

## TypeScript

- Strict mode everywhere. No `any`; use `unknown` and narrow it.
- Prefer named exports. A package exposes its public interface from one entry file and nothing else is imported from outside the package.
- Types that cross a package boundary come from `@sebela/contracts`. Do not redefine them locally.
- Validate at the edges: everything entering the system (HTTP input, environment variables, tool arguments, seed files) is parsed with a Zod schema. Inside the system, trust the types.

## Structure

- Deep modules: a small, stable interface hiding a lot of behaviour. Prefer one module that does a job completely over several thin ones that pass data along.
- API controllers are thin: validate, call a service, return. No domain rules in controllers.
- Database access goes through repositories in `@sebela/db`. Services do not write SQL.
- Authentication is applied as middleware on the private route group in the API, not inside individual handlers.
- No environment access scattered through the code: each app reads and validates its environment once, at startup, and passes configuration down.

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

- Prettier formats; ESLint checks. Both run automatically on changed files.
- A lint rule is never disabled inline to make a check pass without the owner's approval.

## Python

`apps/llm-agent` is the only Python code. Its formatter, linter, type checker and test runner are chosen in phase 7 and recorded here. The same principles apply: validate at the edges, thin handlers, no environment access scattered through the code, no hard-coded endpoints.

## Dependencies

- Adding a dependency needs a reason stated in the pull request. Prefer what is already in the repository.
- Shared tool configuration lives in `@sebela/config`.
