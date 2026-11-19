# @sebela/mcp-admin

The private administrative MCP server: an owner's agent connects to it with an API key and reads (later: writes) content through the content API. Read the root `AGENTS.md` first; this file covers only what is specific to this app. Phase PRD: `.plan/05-mcp-admin/prd.md`; security cases: `.plan/05-mcp-admin/security.md`; eval catalogue: `.plan/05-mcp-admin/evals.md`.

## What it is

- **Hono** supplies the HTTP surface and its protections; the **official MCP TypeScript SDK** supplies the protocol (`@modelcontextprotocol/server` 2.4.0 with `createMcpHandler`, `@modelcontextprotocol/hono` 2.0.2 for Origin validation, `hono` 4.13.18, `@hono/node-server` 2.1.8; the tests use `@modelcontextprotocol/client` 2.4.0). Versions are pinned exactly; upgrade them together. `hono` and `@hono/node-server` are shared with the API through the workspace catalog (`pnpm-workspace.yaml`), so both apps move together. There is no hand-written JSON-RPC and no REST route per tool: one endpoint, `/mcp`, serves the Streamable HTTP transport statelessly (a fresh MCP server per request, no sessions).
- It reaches data only through the content API over HTTP, with the generated `@sebela/api-client`. It never imports `@sebela/db` or `@sebela/services` (the import-boundaries lint rule enforces this) and has no database, migration or storage setting.
- **It stores no API key.** The caller sends `Authorization: Bearer <api-key>`; MCP Admin checks that key with the API's private `GET /v1/authentication` before anything else, on every request (discovery included, and every operation on an existing connection), and forgets it when the request ends. A revoked key fails on its next operation. Keys are created and revoked with the API's existing `api-keys` command (`apps/api/AGENTS.md`); there is no second key store, login, JWT or OAuth.
- Private first-party API calls carry the caller's key; public reads (`GET /v1/person`) carry none. The API destination is configuration only (`MCP_ADMIN_API_URL`); no caller or tool argument chooses it. Redirects from the API are never followed.

## Tools

Only implemented tools are advertised. Future write tools appear when they are implemented.

| Tool       | Arguments                 | Result                                                                                                                                   |
| ---------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `get`      | `{ "entity": "person" }`  | The stored person as JSON (`GET /v1/person`), or the error `not_found` when none is stored. Never a guessed record.                      |
| `describe` | `{ "entity": "project" }` | The JSON Schema of the project create and update bodies (from `@sebela/contracts`) and the records they must refer to. Reads no content. |

Arguments are strict objects: an unknown key, another entity or a credential in the arguments is refused before any read. Both tools carry `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`. Tool errors are `isError` results whose text is `{ "error": { "code", "message" } }` with a fixed message (`not_found`, `unavailable`); an upstream answer, a key or a stack never reaches a result. **Annotations are hints to the client, not proof of human consent**: approval of future destructive tools is the client's configuration (below), and authorization is the API's.

## Request order

Every request passes, in order: the log line (method, path with key-like segments redacted, status; never a header or body), `GET /health` (no key, no API call), the Host check (`MCP_ADMIN_ALLOWED_HOSTS`, else 403 `forbidden`), Origin validation (`MCP_ADMIN_ALLOWED_ORIGINS`; a request without Origin passes, a disallowed one is refused), the gate, the body limit (413 `payload_too_large`), then the MCP handler. The gate (`src/modules/gate`):

1. the pre-authentication budget per client address (429 `rate_limited` with `Retry-After`); `X-Forwarded-For` counts only from `MCP_ADMIN_TRUSTED_PROXIES`. Behind an SSH tunnel every caller arrives from the loopback address, so all tunnel callers share one pre-authentication budget;
2. credentials in the URL (400 `credentials_in_url`);
3. the Bearer key (401 `unauthorized` with `WWW-Authenticate: Bearer`, the same answer for a missing, malformed, unknown, revoked or foreign token);
4. the key check against the API within `MCP_ADMIN_TIMEOUT_MS` (401 for an invalid key; 503 `unavailable` for a timeout, an error, a redirect or a malformed answer: it fails closed);
5. the per-key budget, counted by the key's SHA-256 digest (429);
6. a concurrency slot (503 `busy` beyond `MCP_ADMIN_MAX_CONCURRENT`), held until the response body is fully sent, cancelled or the request is aborted or times out.

Rate limits are fixed windows in memory, per process, bounded by `MCP_ADMIN_RATE_LIMIT_MAX_TRACKED`. Each request's key check is a private API request from MCP Admin's own address, so it also counts against the API's `API_RATE_LIMIT_PRIVATE` budget for that address: keep `MCP_ADMIN_RATE_LIMIT_PREAUTH` within it.

## Commands

| Task                                                                                           | Command                                                                                                   |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Build                                                                                          | `pnpm --filter @sebela/mcp-admin build`                                                                   |
| Start (reads the environment, see below)                                                       | `node --env-file-if-exists=../../.env.local dist/server.js` in this folder, or set the variables yourself |
| Tests (needs the running Postgres and the API build for the end-to-end and eval-harness tests) | `pnpm --filter @sebela/mcp-admin test`                                                                    |
| Check that the eval fixture starts (free)                                                      | `node evals/run.js --check-fixture`                                                                       |
| Model evals (paid; the owner's model key comes only through `harness/with-secrets.mjs`)        | `pnpm --filter @sebela/mcp-admin eval`                                                                    |

The server logs `MCP Admin listening on <url>` once it listens and stops cleanly on SIGTERM or SIGINT: it ends in-flight MCP exchanges and closes its socket.

## Configuration

Every setting is required and documented in `.env.example`; a missing or invalid one stops the process with its name, never its value. Worktree setup writes `MCP_ADMIN_PORT` and `MCP_ADMIN_API_URL` (the worktree's own API) into `.env.local`.

| Variable                                                   | Meaning                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `MCP_ADMIN_HOST`, `MCP_ADMIN_PORT`                         | Interface and port it listens on. Keep the host on loopback.                          |
| `MCP_ADMIN_API_URL`                                        | The content API's base address, http or https without credentials, query or fragment. |
| `MCP_ADMIN_ALLOWED_HOSTS`                                  | Host names a request's `Host` may name.                                               |
| `MCP_ADMIN_ALLOWED_ORIGINS`                                | Host names a present `Origin` may name; empty refuses every browser request.          |
| `MCP_ADMIN_TRUSTED_PROXIES`                                | Proxies whose `X-Forwarded-For` is believed.                                          |
| `MCP_ADMIN_BODY_LIMIT_BYTES`                               | Largest request body.                                                                 |
| `MCP_ADMIN_TIMEOUT_MS`                                     | Longest a request may take, its API calls included.                                   |
| `MCP_ADMIN_MAX_CONCURRENT`                                 | Most requests in progress at once.                                                    |
| `MCP_ADMIN_RATE_LIMIT_PREAUTH`, `MCP_ADMIN_RATE_LIMIT_KEY` | `<requests>/<seconds>` per client address before the key check, and per verified key. |
| `MCP_ADMIN_RATE_LIMIT_MAX_TRACKED`                         | Most callers tracked across both budgets.                                             |

## Container

The profile `mcp-admin` of `compose.yaml` adds the service `mcp-admin`, built from `apps/mcp-admin/Dockerfile` (MCP Admin, the API client and the contracts only; unprivileged `node` user; no environment file). Start it with the API: `docker compose --profile api --profile mcp-admin up --detach --wait`. It listens on the container port 8080, reaches the API as `http://api:8080`, is published on `MCP_ADMIN_HOST`:`MCP_ADMIN_PORT` (loopback) and has a health check on `/health`. Its environment holds only `MCP_ADMIN_*` settings.

Networks: `database` joins Postgres, the migration and the API; `content` joins the API and the website; `admin` joins the API and MCP Admin. MCP Admin has no route to Postgres or the website, the website has none to MCP Admin, and the website holds no API key. The repository check `scripts/checks/compose-policy.test.mjs` verifies this policy from `docker compose config` with the example settings, without building or starting an image (D22, D23); it runs with the root checks on every change, so a change to `compose.yaml`, `.dockerignore` or `.env.example` alone still runs it. The public edge (reverse proxy, TLS, which routes it exposes) is phase 10's; it must expose neither MCP Admin nor private API routes.

## Connecting a client

MCP Admin is never published on a public address. From another machine, open an SSH tunnel to the host's loopback port and connect to the local end:

```bash
ssh -N -L 127.0.0.1:<local-port>:127.0.0.1:<MCP_ADMIN_PORT> <user>@<host>
```

Create a key for the client with `pnpm --silent stack:api-keys create <name>` (or the API's `api-keys` command in a worktree) and keep it in the client's environment, never in a tracked file. Claude Code, project `.mcp.json` (HTTP transport; `${...}` is expanded from the client's environment):

```json
{
  "mcpServers": {
    "sebela-admin": {
      "type": "http",
      "url": "http://127.0.0.1:<local-port>/mcp",
      "headers": { "Authorization": "Bearer ${SEBELA_ADMIN_API_KEY}" }
    }
  }
}
```

Approval: allow the read tools and require a prompt for anything else, for example in the client's `settings.json` `"permissions": { "allow": ["mcp__sebela-admin__get", "mcp__sebela-admin__describe"], "ask": ["mcp__sebela-admin"] }`. Future destructive tools must stay on `ask`.

Limitations: only clients that send a static `Authorization` header over Streamable HTTP are supported; there is no OAuth discovery, so clients that require OAuth for remote servers cannot connect. Sessions, resumable streams and server-sent notifications are not offered (stateless JSON responses). The protocol and authentication lifecycle are verified with the SDK client in `src/mcp.e2e.test.ts`; simulated approval and denial are in the evals. The owner's actual client, its version, the tunnel and the destructive-approval configuration are verified in S05.

## Module map

| Module                         | Interface                                                                                                                                                                                                      | Tests                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `src/config.ts`                | `readMcpAdminConfig(env)`: validated settings, error naming every invalid variable.                                                                                                                            | `src/config.test.ts`                       |
| `src/modules/content/index.ts` | `createContentApi({ baseUrl, fetch? })`: `checkKey(key, signal)` (`valid` / `invalid` / `unavailable`) and `forCaller(key, signal).getPerson()`. Hides the API client, redirect refusal and answer validation. | `src/app.test.ts`, `src/mcp.e2e.test.ts`   |
| `src/modules/gate/index.ts`    | `createGate({ config, content, now })`: Hono middleware that admits a verified caller into `c.var.caller`. Hides budgets, address derivation and slots.                                                        | `src/app.test.ts`                          |
| `src/modules/tools/index.ts`   | `createAdminServer(content)`: the MCP server with the tool catalogue for one caller.                                                                                                                           | `src/app.test.ts`, `src/mcp.e2e.test.ts`   |
| `src/app.ts`                   | `createMcpAdminApp(options)` composes the request order; `startMcpAdminServer(options)` listens.                                                                                                               | `src/app.test.ts`, `src/mcp.e2e.test.ts`   |
| `src/server.ts`                | Startup adapter: configuration, listen, signals.                                                                                                                                                               | `evals/` fixture (starts `dist/server.js`) |
| `evals/`                       | Promptfoo eval harness: catalogue, fixture, graders, gate, runner.                                                                                                                                             | `evals/evals.test.ts`                      |

`src/test-support/` holds the fake API and fixtures of the in-process tests and is not built.

## Tests and evals

- `src/app.test.ts`: the HTTP surface in-process against a fake API (D01, D02, D04–D09, D14, D15).
- `src/mcp.e2e.test.ts`: SDK client -> MCP Admin -> the real API on a temporary database seeded from `evals/fixtures/s01`, with ephemeral named fixture keys that reach only the client's header (D01–D04, D15).
- `scripts/checks/compose-policy.test.mjs` (repository check, `node --test scripts/checks/`): the Compose policy and image (D22, D23), statically.
- Evals (`evals/`): read-only baseline E01, E02 and E29 on fixture S01 with the clock frozen in the prompt only (the API and MCP Admin run on real time) and the model's default sampling; the full catalogue is listed with future write cases pending. Gate: at least 90% of noncritical case-runs and every safety case-run pass across three repeats of each case; a failing gate blocks acceptance. Pinned settings are in `evals/promptfooconfig.yaml`; results go to `.tmp/evals/mcp-admin/`, redacted.
