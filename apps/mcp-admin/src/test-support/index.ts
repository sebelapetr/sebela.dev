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
  photoId: null,
  cvPdfId: null,
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

/** A fictional record of the fake roadmap: a resource, a book or an event, keyed by slug. */
export type FakeRecord = Record<string, unknown> & { slug: string };

/** The fictional roadmap areas and modules; resources name their module by slug. */
export const fictionalAreas = [
  {
    slug: "foundations",
    name: "Foundations",
    modules: [
      { slug: "async-basics", name: "Async Basics" },
      { slug: "concurrency-lab", name: "Concurrency Lab" },
    ],
  },
  { slug: "reading", name: "Reading", modules: [{ slug: "reading-list", name: "Reading List" }] },
] as const;

const STAMP = "2026-01-01T00:00:00.000Z";

/** Two resources share the name "Python Async" in different modules; one resource reads a book. */
export const fictionalResources: readonly FakeRecord[] = [
  {
    slug: "python-async-intro",
    module: "async-basics",
    name: "Python Async",
    type: "video",
    status: "planned",
    link: "https://videos.example.test/python-async",
    book: null,
  },
  {
    slug: "python-async-lab",
    module: "concurrency-lab",
    name: "Python Async",
    type: "project",
    status: "in-progress",
    link: "https://lab.example.test/async",
    book: null,
  },
  {
    slug: "harbor-patterns-book",
    module: "reading-list",
    name: "Harbor Patterns",
    type: "book",
    status: "in-progress",
    link: null,
    book: "harbor-patterns",
  },
];

/** A book linked by `harbor-patterns-book` and one no resource links. */
export const fictionalBooks: readonly FakeRecord[] = [
  { slug: "harbor-patterns", title: "Harbor Patterns", author: "Odile Venn", startedOn: null },
  { slug: "quiet-ledger", title: "The Quiet Ledger", author: "Bram Tolle", startedOn: null },
];

export const fictionalEvents: readonly FakeRecord[] = [
  {
    slug: "fictional-ml-summit-2026",
    name: "Fictional ML Summit",
    kind: "conference",
    startsOn: "2026-11-16",
    endsOn: "2026-11-17",
  },
];

/** One logged interval of the fake diary. */
export interface FakeInterval {
  readonly target: { resource: string } | { event: string };
  readonly startedAt: number;
  readonly endedAt: number;
}

/** The fake roadmap's stored state; tests read and change it directly. */
export interface FakeRoadmap {
  readonly resources: Map<string, FakeRecord>;
  readonly books: Map<string, FakeRecord>;
  readonly events: Map<string, FakeRecord>;
  readonly intervals: FakeInterval[];
  /** The notes of each diary day by its Prague date. */
  readonly notes: Map<string, string>;
}

/** The Europe/Prague calendar date of an instant in milliseconds. */
export function pragueDate(instant: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(instant);
}

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

/** One stored file of the fake API, in the shape of the media contract. */
export interface FakeMedia {
  id: string;
  key: string;
  mediaType: "image/png" | "application/pdf";
  byteSize: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
}

/** The largest file the fake API accepts, like the API's `MEDIA_MAX_BYTES`. */
export const FAKE_MEDIA_MAX_BYTES = 4096;

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
  /** The stored media by id. */
  readonly media: Map<string, FakeMedia>;
  /** The bytes, file name and declared type of every upload the API stored, by media id. */
  readonly files: Map<string, { bytes: Uint8Array; name: string; type: string }>;
  /** The stored person, as `GET /v1/person` returns it. */
  person(): Record<string, unknown>;
  /** The fictional roadmap, books, events and diary. */
  readonly roadmap: FakeRoadmap;
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
  /** Makes storing the next upload fail: the API removes the file and answers 500. */
  failStorage(): void;
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
  const media = new Map<string, FakeMedia>();
  const files = new Map<string, { bytes: Uint8Array; name: string; type: string }>();
  let storageFails = false;
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
    // Like the API: a photo must name stored image media and a CV stored PDF media.
    const wrongMedia = (
      [
        ["photoId", "image/png"],
        ["cvPdfId", "application/pdf"],
      ] as const
    ).flatMap(([field, type]) => {
      const value = body[field];
      if (value === undefined || value === null) return [];
      return typeof value === "string" && media.get(value)?.mediaType === type
        ? []
        : [{ path: field, message: "Name existing media of the right kind." }];
    });
    if (wrongMedia.length > 0) {
      return c.json(refusal("validation_failed", "Invalid.", wrongMedia), 400);
    }
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

  // Media: the content proves the type, like the API's inspection, within FAKE_MEDIA_MAX_BYTES.
  app.get("/v1/media", (c) => c.json([...media.values()].reverse()));
  app.get("/v1/media/:id", (c) => {
    const record = media.get(c.req.param("id"));
    return record ? c.json(record) : c.json(refusal("not_found", "No such media."), 404);
  });
  app.post("/v1/media", async (c) => {
    const type = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (type !== "multipart/form-data") {
      return c.json(refusal("unsupported_media_type", "Send multipart/form-data."), 415);
    }
    const form = await c.req.formData();
    const file = form.get("file");
    const unknown = [...form.keys()].filter((key) => key !== "file" && key !== "altText");
    if (!(file instanceof File) || unknown.length > 0) {
      return c.json(
        refusal("validation_failed", "Some fields are invalid.", [
          { path: unknown[0] ?? "file", message: "Send exactly one file and an optional altText." },
        ]),
        400,
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > FAKE_MEDIA_MAX_BYTES) {
      return c.json(refusal("payload_too_large", "The file is larger than the limit."), 413);
    }
    const text = Buffer.from(bytes).toString("latin1");
    const mediaType = text.startsWith("\x89PNG\r\n\x1a\n")
      ? "image/png"
      : text.startsWith("%PDF-")
        ? "application/pdf"
        : null;
    if (mediaType === null) {
      return c.json(refusal("unsupported_media_type", "Upload a PNG image or a PDF."), 415);
    }
    const extension = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
    if (extension !== (mediaType === "image/png" ? "png" : "pdf")) {
      return c.json(refusal("unsupported_media_type", "The extension does not match."), 415);
    }
    const malformed = mediaType === "image/png" ? !text.includes("IEND") : !text.includes("%%EOF");
    if (malformed) {
      const message = "The file is malformed.";
      return c.json(refusal("validation_failed", message, [{ path: "file", message }]), 400);
    }
    if (storageFails) {
      storageFails = false;
      return c.json(refusal("internal_error", "The file could not be stored."), 500);
    }
    const id = `00000000-0000-4000-9000-${String(media.size + 1).padStart(12, "0")}`;
    const altText = form.get("altText");
    const record: FakeMedia = {
      id,
      key: `fixture/${id}.${extension}`,
      mediaType,
      byteSize: bytes.length,
      width: mediaType === "image/png" ? 2 : null,
      height: mediaType === "image/png" ? 2 : null,
      altText: typeof altText === "string" ? altText : null,
      url: `${API_BASE}/v1/media/files/fixture/${id}.${extension}`,
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    };
    media.set(id, record);
    files.set(id, { bytes, name: file.name, type: file.type });
    audit(c, {
      operation: { operationId: "uploadMedia", method: "POST", route: "/v1/media" },
      entity: "media",
      record: id,
      action: "created",
      before: null,
      after: { ...record },
    });
    return c.json(record, 201);
  });

  // The roadmap: a tree read, resources, books and events written like the real API, and the
  // session action that logs time on a resource or event and appends diary notes atomically.
  const roadmap: FakeRoadmap = {
    resources: new Map(fictionalResources.map((record) => [record.slug, { ...record }])),
    books: new Map(fictionalBooks.map((record) => [record.slug, { ...record }])),
    events: new Map(fictionalEvents.map((record) => [record.slug, { ...record }])),
    intervals: [],
    notes: new Map(),
  };
  const RESOURCE_DEFAULTS = {
    description: null,
    status: "planned",
    estimatedMinutes: null,
    startedAt: null,
    finishedAt: null,
    link: null,
    book: null,
    position: 0,
  };
  const resourceRead = (record: FakeRecord) => ({
    id: "00000000-0000-4000-8000-000000000100",
    ...RESOURCE_DEFAULTS,
    ...record,
    topics: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  });
  const secondsOn = (target: "resource" | "event", slug: string) =>
    roadmap.intervals
      .filter((interval) => (interval.target as Record<string, string>)[target] === slug)
      .reduce((total, interval) => total + (interval.endedAt - interval.startedAt) / 1000, 0);
  const bookRead = (record: FakeRecord) => {
    const linking = [...roadmap.resources.values()].find(
      (resource) => resource["book"] === record.slug,
    );
    const module = fictionalAreas
      .flatMap((area) => area.modules.map((entry) => ({ ...entry, area: area.slug })))
      .find((entry) => entry.slug === linking?.["module"]);
    return {
      id: "00000000-0000-4000-8000-000000000200",
      author: null,
      description: null,
      pages: null,
      year: null,
      isbn: null,
      priority: 0,
      startedOn: null,
      endedOn: null,
      summary: null,
      coverId: null,
      cover: null,
      ...record,
      status: record["endedOn"] ? "completed" : record["startedOn"] ? "reading" : "to-read",
      resource:
        linking && module
          ? { slug: linking.slug, name: linking["name"], module: module.slug, area: module.area }
          : null,
      readingSeconds: linking ? secondsOn("resource", linking.slug) : 0,
      createdAt: STAMP,
      updatedAt: STAMP,
    };
  };
  const eventRead = (record: FakeRecord) => ({
    id: "00000000-0000-4000-8000-000000000300",
    organizer: null,
    place: null,
    online: false,
    link: null,
    takeaways: null,
    ...record,
    topics: [],
    attendanceSeconds: secondsOn("event", record.slug),
    createdAt: STAMP,
    updatedAt: STAMP,
  });

  app.get("/v1/roadmap", (c) =>
    c.json({
      summary: {},
      areas: fictionalAreas.map((area) => ({
        slug: area.slug,
        name: area.name,
        modules: area.modules.map((module) => ({
          slug: module.slug,
          name: module.name,
          resources: [...roadmap.resources.values()]
            .filter((resource) => resource["module"] === module.slug)
            .map((resource) =>
              Object.fromEntries(
                Object.entries(resourceRead(resource)).filter(([key]) => key !== "module"),
              ),
            ),
        })),
      })),
    }),
  );

  /** Get, create and update of one roadmap collection, audited under `entity`. */
  const collection = (options: {
    path: string;
    store: Map<string, FakeRecord>;
    fields: readonly string[];
    entity: string;
    name: string;
    read: (record: FakeRecord) => Record<string, unknown>;
    list?: boolean;
  }) => {
    const { path, store, fields, entity, name, read } = options;
    const missing = () => refusal("not_found", `No such ${entity}.`);
    if (options.list) app.get(path, (c) => c.json([...store.values()].map(read)));
    app.get(`${path}/:slug`, (c) => {
      const record = store.get(c.req.param("slug"));
      return record ? c.json(read(record)) : c.json(missing(), 404);
    });
    app.post(path, async (c) => {
      const body = await c.req.json<Record<string, unknown>>();
      const unknown = unknownFields(body, ["slug", ...fields]);
      if (unknown.length > 0) return c.json(refusal("validation_failed", "Invalid.", unknown), 400);
      const slug = String(body["slug"]);
      if (store.has(slug)) return c.json(refusal("conflict", `"${slug}" exists.`), 409);
      const record = { ...body, slug } as FakeRecord;
      store.set(slug, record);
      audit(c, {
        operation: { operationId: `create${name}`, method: "POST", route: path },
        entity,
        record: slug,
        action: "created",
        before: null,
        after: read(record),
      });
      return c.json(read(record), 201);
    });
    app.patch(`${path}/:slug`, async (c) => {
      const slug = c.req.param("slug");
      const before = store.get(slug);
      if (!before) return c.json(missing(), 404);
      const body = await c.req.json<Record<string, unknown>>();
      const unknown = unknownFields(body, fields);
      if (unknown.length > 0) return c.json(refusal("validation_failed", "Invalid.", unknown), 400);
      const after = { ...before, ...body };
      store.set(slug, after);
      audit(c, {
        operation: { operationId: `update${name}`, method: "PATCH", route: `${path}/{slug}` },
        entity,
        record: slug,
        action: "updated",
        before: read(before),
        after: read(after),
      });
      return c.json(read(after));
    });
  };
  collection({
    path: "/v1/roadmap/resources",
    store: roadmap.resources,
    fields: ["module", "name", "type", "topics", ...Object.keys(RESOURCE_DEFAULTS)],
    entity: "roadmap-resource",
    name: "RoadmapResource",
    read: resourceRead,
  });
  collection({
    path: "/v1/roadmap/books",
    store: roadmap.books,
    fields: [
      "title",
      "author",
      "description",
      "pages",
      "year",
      "isbn",
      "priority",
      "startedOn",
      "endedOn",
      "summary",
      "coverId",
    ],
    entity: "roadmap-book",
    name: "RoadmapBook",
    read: bookRead,
    list: true,
  });
  collection({
    path: "/v1/roadmap/events",
    store: roadmap.events,
    fields: [
      "name",
      "kind",
      "organizer",
      "startsOn",
      "endsOn",
      "place",
      "online",
      "link",
      "takeaways",
      "topics",
    ],
    entity: "roadmap-event",
    name: "RoadmapEvent",
    read: eventRead,
    list: true,
  });

  app.post("/v1/roadmap/sessions", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const unknown = unknownFields(body, ["resource", "event", "startedAt", "endedAt", "notes"]);
    if (unknown.length > 0) return c.json(refusal("validation_failed", "Invalid.", unknown), 400);
    const startedAt = Date.parse(String(body["startedAt"]));
    const endedAt = Date.parse(String(body["endedAt"]));
    const invalid = (path: string, message: string) =>
      c.json(refusal("validation_failed", message, [{ path, message }]), 400);
    let target: FakeInterval["target"];
    if (typeof body["resource"] === "string") {
      if (!roadmap.resources.has(body["resource"])) {
        return invalid("resource", `There is no roadmap resource "${body["resource"]}".`);
      }
      target = { resource: body["resource"] };
    } else {
      const event = roadmap.events.get(String(body["event"]));
      if (!event) return invalid("event", `There is no event "${String(body["event"])}".`);
      const outside = (date: string) =>
        date < String(event["startsOn"]) || date > String(event["endsOn"]);
      if (outside(pragueDate(startedAt))) return invalid("startedAt", "Outside the event.");
      if (outside(pragueDate(endedAt - 1000))) return invalid("endedAt", "Outside the event.");
      target = { event: event.slug };
    }
    if (!(endedAt > startedAt)) return invalid("endedAt", "The end must be after the start.");
    const overlaps = roadmap.intervals.some(
      (interval) => interval.startedAt < endedAt && startedAt < interval.endedAt,
    );
    if (overlaps) return c.json(refusal("conflict", "The time overlaps a logged interval."), 409);

    const dates = [...new Set([pragueDate(startedAt), pragueDate(endedAt - 1000)])].sort();
    const before = new Map(dates.map((date) => [date, roadmap.notes.get(date) ?? null]));
    roadmap.intervals.push({ target, startedAt, endedAt });
    const notes = body["notes"];
    const [first] = dates;
    if (typeof notes === "string" && first !== undefined) {
      const earlier = roadmap.notes.get(first);
      roadmap.notes.set(first, earlier === undefined ? notes : `${earlier}\n\n${notes}`);
    }
    for (const date of dates) {
      audit(c, {
        operation: {
          operationId: "logRoadmapSession",
          method: "POST",
          route: "/v1/roadmap/sessions",
        },
        entity: "roadmap-diary",
        record: date,
        action: "updated",
        before: { date, notes: before.get(date) ?? null },
        after: { date, notes: roadmap.notes.get(date) ?? null },
      });
    }
    const entries = dates.map((date) => ({ date, ...target }));
    return c.json({ entries, dates }, 201);
  });

  app.get("/v1/audit/changes", (c) => c.json({ changes: [...changes].reverse().slice(0, 20) }));

  return {
    calls,
    projects,
    changes,
    media,
    files,
    person: () => person,
    roadmap,
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
    failStorage: () => {
      storageFails = true;
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
