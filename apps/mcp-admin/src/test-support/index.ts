// Test support, excluded from the build: a configuration for in-process tests, a fake content API
// and an MCP SDK client that talks to the app without a socket. Every value here is fictional: the
// host names end in `.test` and the addresses come from the documentation ranges (RFC 5737).
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

import { readMcpAdminConfig, type McpAdminConfig } from "../config.js";

/** The Host the in-process tests address the server by; listed in its allowed hosts. */
export const MCP_HOST = "mcp-admin.test";
/** Where the in-process tests' fake content API lives; never resolved, the fake is called directly. */
export const API_BASE = "http://content-api.test";
/** A client address on the connection, as the Node server would report it. */
export const CLIENT_ADDRESS = "203.0.113.7";

/** Key-shaped fictional credentials the fake API accepts. */
export const KEY_A = `sebela_${"a".repeat(16)}_${"A".repeat(43)}`;
export const KEY_B = `sebela_${"b".repeat(16)}_${"B".repeat(43)}`;
/** Key-shaped, but never valid. */
export const UNKNOWN_KEY = `sebela_${"0".repeat(16)}_${"Z".repeat(43)}`;

export const fictionalPerson = {
  name: "Ilsa Marrow",
  headline: "Fictional systems engineer",
  shortBio: "Ilsa is a **fictional** person.",
  longBio: "Ilsa Marrow exists only in this test.",
  location: "Port Avelin",
  email: "ilsa@marrow.example.test",
  links: [],
  availability: "Not available; this is a test.",
  careerStartedOn: "2015-04-01",
  servicesIntro: "None.",
  collaborationSteps: [],
  servicesNote: "None.",
  photo: null,
  cvPdf: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** Settings for the in-process tests, with every limit overridable. */
export function testConfig(overrides: Record<string, string> = {}): McpAdminConfig {
  return readMcpAdminConfig({
    MCP_ADMIN_HOST: MCP_HOST,
    MCP_ADMIN_PORT: "0",
    MCP_ADMIN_API_URL: API_BASE,
    MCP_ADMIN_ALLOWED_HOSTS: MCP_HOST,
    MCP_ADMIN_ALLOWED_ORIGINS: "",
    MCP_ADMIN_TRUSTED_PROXIES: "",
    MCP_ADMIN_BODY_LIMIT_BYTES: "65536",
    MCP_ADMIN_TIMEOUT_MS: "2000",
    MCP_ADMIN_MAX_CONCURRENT: "4",
    MCP_ADMIN_RATE_LIMIT_PREAUTH: "1000/60",
    MCP_ADMIN_RATE_LIMIT_KEY: "1000/60",
    MCP_ADMIN_RATE_LIMIT_MAX_TRACKED: "1000",
    ...overrides,
  });
}

export interface UpstreamCall {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | null;
  readonly redirect: Request["redirect"];
  /** The `sebela-provenance` header, when one was sent. */
  readonly provenance: string | null;
  /** The request body as text, when one was sent. */
  readonly body: string | null;
}

/** A fictional project of the fake API; `fictionalProjects` holds two of them. */
export interface FakeProject {
  slug: string;
  name: string;
  summary: string;
  result: string;
  experience: string;
  [field: string]: unknown;
}

export const fictionalProjects: readonly FakeProject[] = [
  {
    slug: "harbor-ledger",
    name: "Harbor Ledger",
    summary: "A fictional ledger for a fictional harbor.",
    result: "Fictional invoices arrive on time.",
    experience: "port-avelin-works",
  },
  {
    slug: "harbor-archive",
    name: "Harbor Archive",
    summary: "A fictional archive of fictional ships.",
    result: "Fictional records are found again.",
    experience: "port-avelin-works",
  },
];

/** One audited change of the fake API, in the shape of `GET /v1/audit/changes`. */
export interface FakeChange {
  id: number;
  occurredAt: string;
  actor: { keyId: string; keyName: string };
  operation: { operationId: string; method: "POST" | "PATCH" | "DELETE"; route: string };
  provenance: string | null;
  entity: string;
  record: string | null;
  action: "created" | "updated" | "deleted";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/** When a write's answer goes missing: before the change is committed, or after it. */
export type LostResponse = "before-commit" | "after-commit";

export interface FakeApi {
  /** The upstream `fetch` the app is given. */
  readonly fetch: (request: Request) => Promise<Response>;
  /** Every request the app sent, in order. */
  readonly calls: UpstreamCall[];
  /** The stored projects by slug; tests read and change them directly. */
  readonly projects: Map<string, FakeProject>;
  /** The audited changes, oldest first. */
  readonly changes: FakeChange[];
  /**
   * Replaces the answer of one path (`/v1/authentication`, `/v1/person`), for every method or only
   * `method`.
   */
  answer(
    path: string,
    handler: (request: Request) => Response | Promise<Response>,
    method?: string,
  ): void;
  /** Loses the answer of the next `method` request to `path` with a network error. */
  lose(method: string, path: string, when: LostResponse): void;
  /** Makes deleting the project `slug` a dependency conflict. */
  protect(slug: string): void;
  /** Removes a key from the accepted ones, like a revocation. */
  revoke(key: string): void;
}

/** The fixed fictional key names and identifiers the fake API's audit records. */
const KEY_NAMES = new Map([
  [KEY_A, { keyId: "00000000-0000-4000-8000-00000000000a", keyName: "fixture-a" }],
  [KEY_B, { keyId: "00000000-0000-4000-8000-00000000000b", keyName: "fixture-b" }],
]);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const refusal = (code: string, message: string, fields?: { path: string; message: string }[]) => ({
  error: { code, message, ...(fields ? { fields } : {}) },
});

/**
 * A content API that accepts KEY_A and KEY_B and stores `fictionalPerson` and
 * `fictionalProjects`. Writes need a key, are audited with the key's name and the stated
 * provenance, and refuse unknown fields like the real API.
 */
export function fakeApi(): FakeApi {
  const accepted = new Set([KEY_A, KEY_B]);
  const calls: UpstreamCall[] = [];
  const overrides = new Map<string, (request: Request) => Response | Promise<Response>>();
  const losses = new Map<string, LostResponse>();
  const protectedSlugs = new Set<string>();
  const projects = new Map(fictionalProjects.map((project) => [project.slug, { ...project }]));
  let person: Record<string, unknown> = { ...fictionalPerson };
  const changes: FakeChange[] = [];
  const app = new Hono<{ Variables: { actor: { keyId: string; keyName: string } } }>();

  const presentedKey = (header: string | undefined) => /^Bearer (\S+)$/.exec(header ?? "")?.[1];
  const unauthorized = () =>
    new Response(JSON.stringify(refusal("unauthorized", "A valid API key is required.")), {
      status: 401,
      headers: { "content-type": "application/json", "WWW-Authenticate": "Bearer" },
    });

  app.get("/v1/authentication", (c) => {
    const presented = presentedKey(c.req.header("authorization"));
    if (presented === undefined || !accepted.has(presented)) return unauthorized();
    return c.json({ status: "authenticated" });
  });

  const privateRoute = createMiddleware<{ Variables: { actor: FakeChange["actor"] } }>(
    async (c, next) => {
      const presented = presentedKey(c.req.header("authorization"));
      const actor = presented === undefined ? undefined : KEY_NAMES.get(presented);
      if (presented === undefined || !accepted.has(presented) || actor === undefined) {
        return unauthorized();
      }
      c.set("actor", actor);
      await next();
      return undefined;
    },
  );
  app.use("/v1/audit/*", privateRoute);
  for (const method of ["POST", "PATCH", "DELETE"]) {
    app.on(method, "/v1/*", privateRoute);
  }

  const audit = (
    c: {
      req: { header(name: string): string | undefined };
      get(key: "actor"): FakeChange["actor"];
    },
    change: Omit<FakeChange, "id" | "occurredAt" | "actor" | "provenance">,
  ) => {
    changes.push({
      id: changes.length + 1,
      occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, changes.length)).toISOString(),
      actor: c.get("actor"),
      provenance: c.req.header("sebela-provenance") ?? null,
      ...change,
    });
  };

  const unknownFields = (body: Record<string, unknown>, allowed: readonly string[]) =>
    Object.keys(body)
      .filter((key) => !allowed.includes(key))
      .map((path) => ({ path, message: "Unrecognized key." }));

  app.get("/v1/person", (c) => c.json(person));
  app.patch("/v1/person", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const unknown = unknownFields(body, Object.keys(fictionalPerson));
    if (unknown.length > 0) return c.json(refusal("validation_failed", "Invalid.", unknown), 400);
    const before = person;
    person = { ...person, ...body, updatedAt: "2026-02-01T00:00:00.000Z" };
    audit(c, {
      operation: { operationId: "updatePerson", method: "PATCH", route: "/v1/person" },
      entity: "person",
      record: null,
      action: "updated",
      before,
      after: person,
    });
    return c.json(person);
  });

  // The fields the project contract writes; anything else is refused like the real API does.
  const PROJECT_FIELDS = [
    "name",
    "summary",
    "problem",
    "workDone",
    "result",
    "startedOn",
    "endedOn",
    "links",
    "selectedForHomepage",
    "position",
    "coverId",
    "experience",
    "technologies",
  ];
  app.get("/v1/projects", (c) => c.json([...projects.values()]));
  app.get("/v1/projects/:slug", (c) => {
    const project = projects.get(c.req.param("slug"));
    return project ? c.json(project) : c.json(refusal("not_found", "No such project."), 404);
  });
  app.get("/v1/projects/:slug/case-study", (c) =>
    c.json(refusal("not_found", "No case study."), 404),
  );
  app.post("/v1/projects", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const unknown = unknownFields(body, ["slug", ...PROJECT_FIELDS]);
    if (unknown.length > 0) return c.json(refusal("validation_failed", "Invalid.", unknown), 400);
    const slug = String(body["slug"]);
    if (projects.has(slug)) return c.json(refusal("conflict", `A project "${slug}" exists.`), 409);
    const project = { ...body, slug } as FakeProject;
    projects.set(slug, project);
    audit(c, {
      operation: { operationId: "createProject", method: "POST", route: "/v1/projects" },
      entity: "project",
      record: slug,
      action: "created",
      before: null,
      after: project,
    });
    return c.json(project, 201);
  });
  app.patch("/v1/projects/:slug", async (c) => {
    const slug = c.req.param("slug");
    const before = projects.get(slug);
    if (!before) return c.json(refusal("not_found", "No such project."), 404);
    const body = await c.req.json<Record<string, unknown>>();
    const unknown = unknownFields(body, PROJECT_FIELDS);
    if (unknown.length > 0) return c.json(refusal("validation_failed", "Invalid.", unknown), 400);
    const after = { ...before, ...body };
    projects.set(slug, after);
    audit(c, {
      operation: { operationId: "updateProject", method: "PATCH", route: "/v1/projects/{slug}" },
      entity: "project",
      record: slug,
      action: "updated",
      before,
      after,
    });
    return c.json(after);
  });
  app.delete("/v1/projects/:slug", (c) => {
    const slug = c.req.param("slug");
    const before = projects.get(slug);
    if (!SLUG.test(slug) || !before) return c.json(refusal("not_found", "No such project."), 404);
    if (protectedSlugs.has(slug)) {
      return c.json(
        refusal(
          "conflict",
          `The project "${slug}" still has a case study, is named as evidence by a service or is the subject of a current focus; remove those first.`,
        ),
        409,
      );
    }
    projects.delete(slug);
    audit(c, {
      operation: { operationId: "deleteProject", method: "DELETE", route: "/v1/projects/{slug}" },
      entity: "project",
      record: slug,
      action: "deleted",
      before,
      after: null,
    });
    return c.body(null, 204);
  });

  app.get("/v1/audit/changes", (c) => c.json({ changes: [...changes].reverse().slice(0, 20) }));

  return {
    calls,
    projects,
    changes,
    fetch: async (request) => {
      const url = new URL(request.url);
      const body = request.body === null ? null : await request.clone().text();
      calls.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.get("authorization"),
        redirect: request.redirect,
        provenance: request.headers.get("sebela-provenance"),
        body,
      });
      const override =
        overrides.get(`${request.method} ${url.pathname}`) ?? overrides.get(url.pathname);
      if (override) return override(request);
      const lossKey = `${request.method} ${url.pathname}`;
      const loss = losses.get(lossKey);
      if (loss !== undefined) {
        losses.delete(lossKey);
        if (loss === "after-commit") await app.fetch(request);
        throw new TypeError("fetch failed: the connection was reset");
      }
      return app.fetch(request);
    },
    answer: (path, handler, method) => {
      overrides.set(method === undefined ? path : `${method} ${path}`, handler);
    },
    lose: (method, path, when) => {
      losses.set(`${method} ${path}`, when);
    },
    protect: (slug) => {
      protectedSlugs.add(slug);
    },
    revoke: (key) => {
      accepted.delete(key);
    },
  };
}

/** The Node binding of a request, as `@hono/node-server` sets it. */
export function connection(remoteAddress = CLIENT_ADDRESS) {
  return { incoming: { socket: { remoteAddress } } };
}

type AppFetch = (
  request: Request,
  env: ReturnType<typeof connection>,
) => Response | Promise<Response>;

/** Sends one raw HTTP request to the app in-process. */
export function send(
  fetch: AppFetch,
  path: string,
  init: RequestInit = {},
  remoteAddress = CLIENT_ADDRESS,
): Promise<Response> {
  return Promise.resolve(
    fetch(new Request(`http://${MCP_HOST}${path}`, init), connection(remoteAddress)),
  );
}

/** A JSON-RPC POST to `/mcp` with the headers the Streamable HTTP transport sends. */
export function rpc(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

export const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "fictional-test-client", version: "0.0.0" },
  },
};

/** The official SDK client, connected to the app in-process with `key` as its bearer token. */
export async function connectClient(fetch: AppFetch, key: string | null): Promise<Client> {
  const client = new Client({ name: "mcp-admin-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://${MCP_HOST}/mcp`), {
    requestInit: key === null ? {} : { headers: { Authorization: `Bearer ${key}` } },
    fetch: (url, init) => Promise.resolve(fetch(new Request(url, init), connection())),
  });
  await client.connect(transport);
  return client;
}

/** The text of a tool result's first content block. */
export function toolText(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content[0]?.text ?? "";
}
