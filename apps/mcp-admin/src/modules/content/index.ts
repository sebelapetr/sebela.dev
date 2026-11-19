/**
 * The content API as MCP Admin uses it: one fixed base address, the caller's own key, a fixed
 * registry of content entities and outcomes instead of HTTP details.
 *
 * Every request goes to the configured base address only, on a route the registry names or the
 * API's session action (`POST /v1/roadmap/sessions`); nothing a caller sends can choose another
 * address, route, query or operator. Redirects are never followed,
 * so a key cannot be carried to a third host. Reads use the public routes; writes carry the
 * caller's key and a provenance label. A study session or event attendance is logged through the
 * API's one session action, which writes its time and its diary notes together.
 *
 * A write's identifier and fields are checked against the shared contracts before anything is
 * sent. An update or delete reads its record first and does not write one that is not there. A
 * write is sent exactly once and never replayed: when its answer is lost, the outcome is taken
 * from the API's audit (an entry after the write began with this write's own provenance) or
 * reported as `uncertain`. Upstream text reaches a caller only as a field error or conflict
 * message of the API, with key-shaped text removed and its length bounded.
 *
 * An upload sends only the bytes its caller passed, once, as the API's multipart media upload
 * under a plain file name; it never reads a path, fetches an address or reaches storage. The API
 * inspects, stores and audits the file; a refused file is a field error on `file` and nothing is
 * stored, so a reference to earlier media stays as it was.
 */
import { randomBytes } from "node:crypto";

import { createApiClient, type ApiClient } from "@sebela/api-client";
import {
  auditProvenanceHeader,
  RoadmapSessionCreateSchema,
  RecentChangesSchema,
  recentChangesLimit,
  type AuditChange,
  type RecentChanges,
} from "@sebela/contracts";
import { z } from "zod";

import {
  definitionOf,
  operationsOf,
  type Entity,
  type EntityDefinition,
  type Operation,
  type Relationship,
} from "./registry.js";

export { ENTITIES, type Entity, type Operation } from "./registry.js";

export type KeyCheck = "valid" | "invalid" | "unavailable";

export type ErrorCode =
  "field" | "conflict" | "not_found" | "unavailable" | "uncertain" | "unsupported_operation";

export interface FieldProblem {
  readonly path: string;
  readonly message: string;
}

export interface ContentError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly fields?: readonly FieldProblem[];
  /** Stored records the caller may have meant, so a collision can be put to the owner. */
  readonly candidates?: readonly unknown[];
}

export type Outcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ContentError };

export interface SaveRequest {
  readonly action: "create" | "update";
  readonly id?: string | undefined;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** A committed write. `reconciled` when its answer was lost and the audit showed it committed. */
export interface WriteResult {
  readonly entity: Entity;
  readonly id: string | null;
  readonly action: "created" | "updated" | "deleted";
  readonly record?: unknown;
  readonly reconciled?: true;
}

export interface UploadRequest {
  /** A plain file name whose extension names the type, such as `portrait.png`; never a path. */
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly altText?: string | undefined;
}

/** One study session on a resource, or attendance at an event: exactly one target. */
export interface SessionRequest {
  readonly resource?: string | undefined;
  readonly event?: string | undefined;
  /** An absolute instant with `Z` or an offset. */
  readonly startedAt: string;
  readonly endedAt: string;
  /** Markdown appended to the notes of the session's first Prague day. */
  readonly notes?: string | undefined;
}

/** A logged session: every Prague diary day it changed, ascending. */
export interface SessionResult {
  readonly dates: readonly string[];
  /** Present when its answer was lost and the audit showed it committed. */
  readonly reconciled?: true;
}

/** The content API on behalf of one verified caller, for one MCP request. */
export interface CallerContent {
  /** Every record of `entity`, read through its public route. */
  list(entity: Entity): Promise<Outcome<unknown>>;
  /** One record of `entity` (the person without an `id`), read through its public route. */
  get(entity: Entity, id?: string): Promise<Outcome<unknown>>;
  /** Creates a record, or changes only the given fields of an existing one. */
  save(entity: Entity, request: SaveRequest): Promise<Outcome<WriteResult>>;
  /** Deletes exactly the one named record, unless the API protects it. */
  remove(entity: Entity, id: string): Promise<Outcome<WriteResult>>;
  /**
   * Uploads the caller's file as new media; the result's `id` is the stored media's UUID, which
   * can then be attached. A refused file stores nothing.
   */
  upload(request: UploadRequest): Promise<Outcome<WriteResult>>;
  /**
   * Logs one session's time and appends its notes in one audited write, split at Prague midnight.
   * An overlap with any logged interval is a `conflict` and changes nothing.
   */
  logSession(request: SessionRequest): Promise<Outcome<SessionResult>>;
  /** The newest audited content changes, newest first, at most twenty, read with the key. */
  recentChanges(): Promise<Outcome<RecentChanges>>;
}

export interface ContentApi {
  /**
   * Asks the API whether `key` is a valid, unrevoked API key. `valid` only for exactly the
   * documented success answer; `invalid` for a refusal; `unavailable` for everything else.
   */
  checkKey(key: string, signal: AbortSignal): Promise<KeyCheck>;
  /** Content operations that carry `key` where the API requires one and abort with `signal`. */
  forCaller(key: string, signal: AbortSignal): CallerContent;
}

export interface ContentApiOptions {
  /** The API's base address, without a trailing slash. */
  readonly baseUrl: string;
  /** The transport; the platform `fetch` when omitted. Tests pass a fake API. */
  readonly fetch?: (request: Request) => Promise<Response>;
}

/** How a content entity is written: its operations, contracts and the records it refers to. */
export interface EntityDescription {
  readonly entity: Entity;
  readonly summary: string;
  readonly operations: readonly Operation[];
  readonly id: string | null;
  readonly create?: Record<string, unknown>;
  readonly update?: Record<string, unknown>;
  readonly relationships: readonly Relationship[];
  readonly notes?: readonly string[];
}

/** The description of `entity`, derived from the registry and the shared contracts. */
export function describeEntity(entity: Entity): EntityDescription {
  const definition = definitionOf(entity);
  return {
    entity,
    summary: definition.summary,
    operations: operationsOf(definition),
    id: definition.id?.description ?? null,
    ...(definition.create ? { create: inputSchema(definition.create.schema) } : {}),
    ...(definition.update ? { update: inputSchema(definition.update.schema) } : {}),
    relationships: definition.relationships,
    ...(definition.notes ? { notes: definition.notes } : {}),
  };
}

/**
 * The input JSON Schema of a contract with its root object inline. A contract named with `.meta({id})`
 * would otherwise be only a `$ref` into `$defs`; other shared definitions stay in `$defs`.
 */
function inputSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<
    string,
    unknown
  >;
  const ref = json["$ref"];
  const defs = json["$defs"] as Record<string, Record<string, unknown>> | undefined;
  if (typeof ref !== "string" || defs === undefined) return json;
  const name = ref.replace(/^#\/\$defs\//, "");
  const { [name]: root, ...rest } = defs;
  if (root === undefined || JSON.stringify(rest).includes(`"#/$defs/${name}"`)) return json;
  return {
    $schema: json["$schema"],
    ...root,
    ...(Object.keys(rest).length > 0 ? { $defs: rest } : {}),
  };
}

const UNAVAILABLE: ContentError = {
  code: "unavailable",
  message: "The content API is unavailable; retry later.",
};
const UNCERTAIN: ContentError = {
  code: "uncertain",
  message:
    "The write was sent once but its outcome is unknown, and the audit does not show it. It was " +
    "not retried. Read the record and the recent changes before deciding what to do.",
};
const MAX_MESSAGE = 500;

function fail<T>(error: ContentError): Outcome<T> {
  return { ok: false, error };
}

function unsupported<T>(entity: Entity, operation: Operation): Outcome<T> {
  const supported = operationsOf(definitionOf(entity)).join(", ");
  return fail({
    code: "unsupported_operation",
    message: `${entity} does not support ${operation}. It supports: ${supported}.`,
  });
}

function idProblem<T>(message: string): Outcome<T> {
  return fail({
    code: "field",
    message: "The record identifier is invalid.",
    fields: [{ path: "id", message }],
  });
}

function notFound<T>(entity: Entity): Outcome<T> {
  return fail({
    code: "not_found",
    message: entity === "person" ? "No person is stored yet." : `No ${entity} with this id exists.`,
  });
}

/** Removes API-key-shaped and bearer text and bounds the length of upstream text. */
function redact(text: string): string {
  const cleaned = text
    .replace(/sebela_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  return cleaned.length > MAX_MESSAGE ? `${cleaned.slice(0, MAX_MESSAGE)}…` : cleaned;
}

function zodProblems(error: z.ZodError): FieldProblem[] {
  return error.issues.flatMap((issue) => {
    const base = issue.path.map(String);
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => ({
        path: [...base, key].join("."),
        message: "This field cannot be written.",
      }));
    }
    return [{ path: base.join(".") || "fields", message: issue.message }];
  });
}

/** The API's field problems of a 400 answer, redacted; empty when it carries none. */
function apiProblems(body: unknown): FieldProblem[] {
  const fields = (body as { error?: { fields?: unknown } } | undefined)?.error?.fields;
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((entry: unknown) => {
    const { path, message } = (entry ?? {}) as { path?: unknown; message?: unknown };
    return typeof path === "string" && typeof message === "string"
      ? [{ path: redact(path), message: redact(message) }]
      : [];
  });
}

function apiMessage(body: unknown, fallback: string): string {
  const message = (body as { error?: { message?: unknown } } | undefined)?.error?.message;
  return typeof message === "string" && message.length > 0 ? redact(message) : fallback;
}

interface Init {
  params?: { path?: Record<string, string> };
  body?: unknown;
  bodySerializer?: (body: unknown) => FormData;
  headers?: Record<string, string>;
  signal: AbortSignal;
}
interface Answer {
  data?: unknown;
  error?: unknown;
  response: Response;
}
/** The generated client seen through the registry's routes, which the registry has typed. */
type Call = (route: string, init: Init) => Promise<Answer>;

export function createContentApi(options: ContentApiOptions): ContentApi {
  const upstream = options.fetch ?? ((request: Request) => fetch(request));
  // Whatever the generated client builds, the request goes out with redirects left unfollowed.
  const send = (request: Request) => upstream(new Request(request, { redirect: "manual" }));
  const client = (apiKey?: string): ApiClient =>
    createApiClient({
      baseUrl: options.baseUrl,
      fetch: send,
      ...(apiKey === undefined ? {} : { apiKey }),
    });

  return {
    async checkKey(key, signal) {
      try {
        const { data, response } = await client(key).GET("/v1/authentication", { signal });
        if (response.status === 401) return "invalid";
        const exact =
          response.status === 200 &&
          typeof data === "object" &&
          Object.keys(data).length === 1 &&
          (data as { status?: unknown }).status === "authenticated";
        return exact ? "valid" : "unavailable";
      } catch {
        return "unavailable";
      }
    },

    forCaller(key, signal) {
      return callerContent(client(key), signal);
    },
  };
}

function callerContent(api: ApiClient, signal: AbortSignal): CallerContent {
  const http = {
    GET: api.GET as unknown as Call,
    POST: api.POST as unknown as Call,
    PATCH: api.PATCH as unknown as Call,
    DELETE: api.DELETE as unknown as Call,
  };

  const pathOf = (
    definition: EntityDefinition,
    id: string | undefined,
  ): NonNullable<Init["params"]> =>
    definition.id && id !== undefined ? { path: { [definition.id.param]: id } } : {};

  /** Checks the `id` of an operation on an existing record; `undefined` when it is acceptable. */
  function checkId(
    definition: EntityDefinition,
    id: string | undefined,
  ): Outcome<never> | undefined {
    if (definition.id === null) {
      return id === undefined
        ? undefined
        : idProblem(`${definition.entity} has no identifier; leave out \`id\`.`);
    }
    if (id === undefined) return idProblem(`Required: ${definition.id.description}`);
    return definition.id.schema.safeParse(id).success
      ? undefined
      : idProblem(`Not a valid identifier. ${definition.id.description}`);
  }

  async function read(
    route: string,
    definition: EntityDefinition,
    id?: string,
  ): Promise<Outcome<unknown>> {
    try {
      const { data, response } = await http.GET(route, { params: pathOf(definition, id), signal });
      if (response.status === 200 && data !== undefined) return { ok: true, value: data };
      if (response.status === 404) return notFound(definition.entity);
      return fail(UNAVAILABLE);
    } catch {
      return fail(UNAVAILABLE);
    }
  }

  async function audit(): Promise<RecentChanges | undefined> {
    try {
      const { data, response } = await http.GET("/v1/audit/changes", { signal });
      if (response.status !== 200) return undefined;
      const parsed = RecentChangesSchema.safeParse(data);
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  /** The highest audit entry id now, so a lost write can later be found among newer entries. */
  async function highWaterMark(): Promise<number | undefined> {
    const recent = await audit();
    return recent ? Math.max(0, ...recent.changes.map((change) => change.id)) : undefined;
  }

  /** This write's own entries in the audit, oldest first; `undefined` when the audit is unreadable. */
  async function ownChanges(
    mark: number,
    provenance: string,
    method: AuditChange["operation"]["method"],
  ): Promise<AuditChange[] | undefined> {
    const recent = await audit();
    return recent?.changes
      .filter(
        (change) =>
          change.id > mark &&
          change.provenance === provenance &&
          change.operation.method === method,
      )
      .reverse();
  }

  interface Sent {
    readonly mark: number;
    readonly provenance: string;
    /** `undefined` when the answer was lost on the way back. */
    readonly answer: Answer | undefined;
  }

  interface WriteSpec {
    readonly definition: EntityDefinition;
    readonly method: "POST" | "PATCH" | "DELETE";
    readonly route: string;
    readonly id: string | undefined;
    /** JSON fields, or the multipart form of an upload. */
    readonly body: unknown;
    readonly action: WriteResult["action"];
    /** The written record's id when known before the write; an upload takes it from the answer. */
    readonly knownId: string | null;
    readonly upload?: boolean;
  }

  /**
   * Sends one write exactly once under a fresh provenance of `kind`. The audit's high-water mark is
   * taken first, so a lost answer can be reconciled; without it nothing is sent.
   */
  async function sendOnce(
    method: "POST" | "PATCH" | "DELETE",
    route: string,
    params: NonNullable<Init["params"]>,
    body: unknown,
    kind: "save" | "delete" | "upload" | "session",
  ): Promise<Sent | undefined> {
    const mark = await highWaterMark();
    if (mark === undefined) return undefined;
    const provenance = `mcp-admin/${kind}/${randomBytes(6).toString("hex")}`;
    try {
      const answer = await http[method](route, {
        params,
        ...(body === undefined ? {} : { body }),
        ...(kind === "upload" ? { bodySerializer: (form: unknown) => form as FormData } : {}),
        headers: { [auditProvenanceHeader]: provenance },
        signal,
      });
      return { mark, provenance, answer };
    } catch {
      return { mark, provenance, answer: undefined };
    }
  }

  /**
   * The outcome of a documented refusal; `undefined` for a success, a lost answer or one the API
   * does not document, which only the audit can settle. An upload's refused file (too large, an
   * unsupported type, empty or malformed) is a field error on `file`: the API stored nothing.
   */
  function refusal(
    answer: Answer | undefined,
    entity: Entity,
    upload = false,
  ): Outcome<never> | undefined {
    if (!answer) return undefined;
    const { status } = answer.response;
    if (upload && (status === 413 || status === 415)) {
      return fileProblem(
        "file",
        status === 413
          ? "The file is larger than the API accepts."
          : apiMessage(
              answer.error,
              "The file's type is not supported or its name contradicts it.",
            ),
      );
    }
    if (upload && status === 400 && apiProblems(answer.error).length === 0) {
      return fileProblem("file", apiMessage(answer.error, "The file is empty or malformed."));
    }
    if (status === 400) {
      const fields = apiProblems(answer.error);
      return fail({
        code: "field",
        message: apiMessage(answer.error, "The API refused the fields."),
        ...(fields.length > 0 ? { fields } : {}),
      });
    }
    if (status === 404) return notFound(entity);
    if (status === 409) {
      return fail({
        code: "conflict",
        message: apiMessage(answer.error, "The change conflicts with stored content."),
      });
    }
    // A refusal before the write (key, size, type, rate): nothing changed.
    if ([401, 403, 413, 415, 429].includes(status)) return fail(UNAVAILABLE);
    return undefined;
  }

  const succeeded = (answer: Answer | undefined): answer is Answer =>
    answer !== undefined && answer.response.status >= 200 && answer.response.status < 300;

  async function write({
    definition,
    method,
    route,
    id,
    body,
    action,
    knownId,
    upload = false,
  }: WriteSpec): Promise<Outcome<WriteResult>> {
    const entity = definition.entity;
    const sent = await sendOnce(
      method,
      route,
      pathOf(definition, id),
      body,
      upload ? "upload" : method === "DELETE" ? "delete" : "save",
    );
    if (!sent) return fail(UNAVAILABLE);
    const { answer } = sent;
    if (succeeded(answer)) {
      const record = answer.data;
      const createdId = upload ? (record as { id?: unknown } | undefined)?.id : knownId;
      return {
        ok: true,
        value: {
          entity,
          id: typeof createdId === "string" ? createdId : knownId,
          action,
          ...(record === undefined || action === "deleted" ? {} : { record }),
        },
      };
    }
    const refused = refusal(answer, entity, upload);
    if (refused) return refused;

    // The answer was lost or is not one the API documents: never resend; ask the audit.
    if (signal.aborted) return fail(UNCERTAIN);
    const [own] = (await ownChanges(sent.mark, sent.provenance, method)) ?? [];
    if (!own) return fail(UNCERTAIN);
    return {
      ok: true,
      value: {
        entity,
        id: own.record,
        action,
        ...(own.after === null ? {} : { record: own.after }),
        reconciled: true,
      },
    };
  }

  return {
    async list(entity) {
      const definition = definitionOf(entity);
      if (!definition.list) return unsupported(entity, "list");
      return read(definition.list, definition);
    },

    async get(entity, id) {
      const definition = definitionOf(entity);
      if (!definition.get) return unsupported(entity, "get");
      const problem = checkId(definition, id);
      if (problem) return problem;
      return read(definition.get, definition, id);
    },

    async save(entity, { action, id, fields }) {
      const definition = definitionOf(entity);
      if (action === "create") {
        const create = definition.create;
        if (!create) return unsupported(entity, action);
        if (create.idFrom === "id") {
          const problem = checkId(definition, id);
          if (problem) return problem;
        } else if (id !== undefined) {
          return idProblem(
            create.idFrom === "slug"
              ? "A new record has no `id` yet; give its slug in `fields.slug`."
              : `A new ${entity} has no \`id\`; leave it out.`,
          );
        }
        const checked = create.schema.safeParse(fields);
        if (!checked.success) return fieldProblems(checked.error);
        const newId =
          create.idFrom === "slug"
            ? (fields["slug"] as string)
            : create.idFrom === "id"
              ? (id ?? null)
              : null;
        return write({
          definition,
          method: "POST",
          route: create.route,
          id,
          body: fields,
          action: "created",
          knownId: newId,
        });
      }

      const update = definition.update;
      if (!update) return unsupported(entity, action);
      const problem = checkId(definition, id);
      if (problem) return problem;
      const checked = update.schema.safeParse(fields);
      if (!checked.success) return fieldProblems(checked.error);
      if (!update.upsert && definition.get) {
        const current = await read(definition.get, definition, id);
        if (!current.ok) return current;
      }
      return write({
        definition,
        method: "PATCH",
        route: update.route,
        id,
        body: fields,
        action: "updated",
        knownId: id ?? null,
      });
    },

    async remove(entity, id) {
      const definition = definitionOf(entity);
      if (!definition.delete) return unsupported(entity, "delete");
      const problem = checkId(definition, id);
      if (problem) return problem;
      if (definition.get) {
        const current = await read(definition.get, definition, id);
        if (!current.ok) return current;
      }
      return write({
        definition,
        method: "DELETE",
        route: definition.delete,
        id,
        body: undefined,
        action: "deleted",
        knownId: id,
      });
    },

    async upload({ fileName, bytes, altText }) {
      if (!isPlainFileName(fileName)) {
        return fileProblem(
          "fileName",
          "A plain file name such as `portrait.png`: no folders, drive, address or hidden name.",
          "The file name is not a plain file name; nothing was sent.",
        );
      }
      if (bytes.byteLength === 0) {
        return fileProblem("file", "The file is empty.", "The file is empty; nothing was sent.");
      }
      const form = new FormData();
      // The API proves the type from the content; the declared type stays generic.
      form.set(
        "file",
        new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }),
        fileName,
      );
      if (altText !== undefined) form.set("altText", altText);
      return write({
        definition: definitionOf("media"),
        method: "POST",
        route: "/v1/media",
        id: undefined,
        body: form,
        action: "created",
        knownId: null,
        upload: true,
      });
    },

    async logSession(request) {
      const body = Object.fromEntries(
        Object.entries(request).filter(([, value]) => value !== undefined),
      );
      const checked = RoadmapSessionCreateSchema.safeParse(body);
      if (!checked.success) return fieldProblems(checked.error);
      const sent = await sendOnce("POST", "/v1/roadmap/sessions", {}, body, "session");
      if (!sent) return fail(UNAVAILABLE);
      const { answer } = sent;
      if (succeeded(answer)) {
        const dates = (answer.data as { dates?: unknown } | undefined)?.dates;
        if (Array.isArray(dates) && dates.every((date) => typeof date === "string")) {
          return { ok: true, value: { dates } };
        }
      } else {
        const refused = refusal(answer, "roadmap-diary");
        if (refused) return refused;
      }

      // Lost, undocumented or unreadable: the audit's entries of this session settle it.
      if (signal.aborted) return fail(UNCERTAIN);
      const own = await ownChanges(sent.mark, sent.provenance, "POST");
      const dates = [...new Set((own ?? []).flatMap((change) => change.record ?? []))].sort();
      if (dates.length === 0) return fail(UNCERTAIN);
      return { ok: true, value: { dates, reconciled: true } };
    },

    async recentChanges() {
      const recent = await audit();
      return recent
        ? { ok: true, value: { changes: recent.changes.slice(0, recentChangesLimit) } }
        : fail(UNAVAILABLE);
    },
  };
}

/**
 * A file name with nothing that could name a place: no separator, drive, scheme or control
 * character, not hidden, with a name before its extension.
 */
function isPlainFileName(name: string): boolean {
  if (name.length === 0 || name.length > 255 || name.startsWith(".")) return false;
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || "/\\:".includes(name.charAt(index))) return false;
  }
  return true;
}

function fileProblem<T>(path: "file" | "fileName", message: string, summary?: string): Outcome<T> {
  return fail({
    code: "field",
    message: summary ?? "The file was refused; nothing was stored.",
    fields: [{ path, message }],
  });
}

function fieldProblems<T>(error: z.ZodError): Outcome<T> {
  return fail({
    code: "field",
    message: "Some fields cannot be written; nothing was sent.",
    fields: zodProblems(error),
  });
}
