import { Scalar } from "@scalar/hono-api-reference";
import { Hono, type MiddlewareHandler } from "hono";
import { every } from "hono/combine";
import { z } from "zod";

import {
  ContentChangeSchema,
  auditProvenanceHeader,
  type AuditEntity,
  type ContentChange,
  type ContentChangeAction,
} from "@sebela/contracts";
import type {
  AuditService,
  KnowledgeService,
  MediaService,
  ProfileService,
  RoadmapService,
  Services,
} from "@sebela/services";

import type { ApiConfig } from "./config.js";
import { authenticate, refuseCredentialsInUrl } from "./middleware/authentication.js";
import type { ApiEnv } from "./middleware/context.js";
import { ApiError, handleErrors } from "./middleware/errors.js";
import { jsonBody } from "./middleware/json-body.js";
import { multipartBody } from "./middleware/multipart-body.js";
import { pathParams } from "./middleware/path-params.js";
import { createRateLimits } from "./middleware/limits.js";
import { noSniff, redact, requestLog, type Logger } from "./middleware/logging.js";
import { auditRoutes } from "./modules/audit/index.js";
import { type ChatDispatcher, type ChatTiming } from "./modules/chat/index.js";
import { mediaRoutes } from "./modules/media/index.js";
import { profileRoutes } from "./modules/profile/index.js";
import { retrievalRoutes } from "./modules/retrieval/index.js";
import { roadmapRoutes } from "./modules/roadmap/index.js";
import { createOpenApiDocument } from "./openapi.js";
import {
  fillLocation,
  type FileResponse,
  type RouteAudit,
  type RouteDefinition,
  type RouteDocumentation,
} from "./routing.js";

export type { Logger };

/** What a successful write reports to the attachment point for interested parties. */
export interface WriteEvent {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  /**
   * The content record the write changed. A write that changes several records, such as a time
   * entry over two diary days, reports one event for each.
   */
  readonly change: ContentChange;
}

export type WriteNotifier = (event: WriteEvent) => Promise<void>;

const ACTIONS: Record<Exclude<RouteDocumentation["method"], "GET">, ContentChangeAction> = {
  POST: "created",
  PATCH: "updated",
  DELETE: "deleted",
};

const property = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;

const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** Whether a route changes content: every method but `GET`, unless the route is `readOnly`. */
const writes = <Route extends Pick<RouteDocumentation, "method" | "readOnly">>(
  route: Route,
): route is Route & { readonly method: Exclude<RouteDocumentation["method"], "GET"> } =>
  route.method !== "GET" && route.readOnly !== true;

/**
 * How a write route is audited: its own `audit`, or else as its content domain, for the person or
 * the record its `slug`, `id` or `date` path parameter names, or for a create the record its
 * result's `slug` or `id` names. `null` for a read.
 */
function auditOf(
  route: Pick<RouteDefinition, "method" | "readOnly" | "content" | "audit">,
): RouteAudit | null {
  if (!writes(route) || !route.content) return null;
  if (route.audit) return route.audit;
  const entity = route.content;
  const addressed = (params: unknown) => {
    if (entity === "person") return [null];
    const record =
      text(property(params, "slug")) ??
      text(property(params, "id")) ??
      text(property(params, "date"));
    return record === undefined ? [] : [record];
  };
  return {
    entity,
    records: addressed,
    recordsOf: (result) => {
      if (entity === "person") return [];
      const record = text(property(result, "slug")) ?? text(property(result, "id"));
      return record === undefined ? [] : [record];
    },
  };
}

/**
 * The content changes a committed write made: its route's domain and action, and each record the
 * route's `records` names, or else the one record named by the `slug` or `id` path parameter, or by
 * the result. The person has no record. `null` when a record cannot be named; the app then logs it
 * instead of notifying.
 */
function changesOf(
  route: RouteDefinition,
  params: unknown,
  result: unknown,
): ContentChange[] | null {
  if (!writes(route) || !route.content) return null;
  const records: readonly unknown[] = route.records
    ? route.records({ params, result })
    : [
        route.content === "person"
          ? null
          : (property(params, "slug") ??
            property(params, "id") ??
            property(result, "slug") ??
            property(result, "id")),
      ];
  const changes: ContentChange[] = [];
  for (const record of records) {
    const parsed = ContentChangeSchema.safeParse({
      domain: route.content,
      record,
      action: ACTIONS[route.method],
    });
    if (!parsed.success) return null;
    changes.push(parsed.data);
  }
  return changes.length > 0 ? changes : null;
}

export interface AppDependencies {
  readonly services: Pick<
    Services,
    "profile" | "apiKeys" | "media" | "roadmap" | "audit" | "knowledge" | "health" | "chat"
  >;
  readonly config: ApiConfig;
  /** Milliseconds since the epoch, for rate-limit windows. */
  readonly now?: () => number;
  readonly log?: Logger;
  /**
   * Called after every committed write, never after a failed one, each notifier in order; a
   * failure is logged by the error's name only and never fails or rolls back the write, nor keeps
   * a later notifier from being called.
   */
  readonly onWrite?: WriteNotifier | readonly WriteNotifier[];
  /**
   * Hands each admitted chat question to the AI service, required when `config.chat` is set. The
   * request that admitted the question never waits for it.
   */
  readonly chatDispatcher?: ChatDispatcher;
  /** The chat event stream's polling, progress and deadline grace, for tests. */
  readonly chatTiming?: Partial<ChatTiming>;
}

/** A route as it is registered and documented. */
export interface RouteSummary {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly access: "public" | "private";
  /** Whether the route reads a body, JSON or a multipart upload. */
  readonly hasBody: boolean;
  /** The entity a write route audits its changes as; `null` for a read. */
  readonly audit: AuditEntity | null;
}

export interface Api {
  readonly app: Hono<ApiEnv>;
  readonly routes: readonly RouteSummary[];
}

const HealthSchema = z.object({ status: z.literal("ok") }).meta({ id: "Health" });
const ReadinessSchema = z.object({ status: z.literal("ready") }).meta({ id: "Readiness" });
const AuthenticationCheckSchema = z
  .object({ status: z.literal("authenticated") })
  .meta({ id: "AuthenticationCheck" });

const systemRoutes = {
  health: {
    operationId: "getHealth",
    method: "GET",
    path: "/health",
    access: "public",
    summary: "Liveness",
    budget: "health",
    description: "Answers while the process runs; it does not check the database. Its own budget.",
    response: { status: 200, description: "The API is running.", schema: HealthSchema },
    errors: [],
  },
  readiness: {
    operationId: "getReadiness",
    method: "GET",
    path: "/health/ready",
    access: "public",
    summary: "Readiness",
    budget: "health",
    description:
      "Answers whether the API can serve content now: it checks that the database answers within " +
      "a short time. For uptime monitoring and the website's health check; never cached. Shares " +
      "the health budget.",
    response: {
      status: 200,
      description: "The API and its database answer.",
      schema: ReadinessSchema,
    },
    errors: ["unavailable"],
  },
  authentication: {
    operationId: "checkAuthentication",
    method: "GET",
    path: "/v1/authentication",
    access: "private",
    summary: "Check the API key",
    description:
      "Answers whether the presented API key is valid now, with the same verification and budgets as " +
      "every private route. It reads and changes no content and reveals nothing about the key. A " +
      "server-side caller that acts for the key holder, such as MCP Admin, checks it before every " +
      "operation, so a revoked key stops working on its next one.",
    response: { status: 200, description: "The key is valid.", schema: AuthenticationCheckSchema },
    errors: [],
  },
  openapi: {
    operationId: "getOpenApiDocument",
    method: "GET",
    path: "/openapi.json",
    access: "public",
    summary: "This OpenAPI document",
    response: { status: 200, description: "The OpenAPI 3.1 document." },
    errors: [],
  },
  reference: {
    operationId: "getReference",
    method: "GET",
    path: "/reference",
    access: "public",
    summary: "Browsable API reference",
    response: { status: 200, description: "The reference page.", mediaType: "text/html" },
    errors: [],
  },
} satisfies Record<string, RouteDocumentation>;

type OpenApiDocument = ReturnType<typeof createOpenApiDocument>;

/** The module routes, in registration and documentation order. */
const moduleRoutes = (
  services: Pick<Services, "profile" | "media" | "roadmap" | "audit" | "knowledge">,
): RouteDefinition[] => [
  ...profileRoutes(services.profile),
  ...mediaRoutes(services.media),
  ...roadmapRoutes(services.roadmap),
  ...auditRoutes(services.audit),
  ...retrievalRoutes(services.knowledge),
];

/** Every documented route, in the order of the OpenAPI document. */
const documentedRoutes = (modules: readonly RouteDefinition[]): RouteDocumentation[] => [
  systemRoutes.health,
  systemRoutes.readiness,
  systemRoutes.authentication,
  ...modules,
  systemRoutes.openapi,
  systemRoutes.reference,
];

const documentationOnly = (): Promise<never> =>
  Promise.reject(new Error("This service only describes the API; it serves no request."));

/** A profile service for describing routes; describing never calls it. */
const describingProfile: ProfileService = {
  getPerson: documentationOnly,
  createPerson: documentationOnly,
  updatePerson: documentationOnly,
  deletePerson: documentationOnly,
  getCv: documentationOnly,
  listTechnologies: documentationOnly,
  getTechnology: documentationOnly,
  createTechnology: documentationOnly,
  updateTechnology: documentationOnly,
  deleteTechnology: documentationOnly,
  listTopics: documentationOnly,
  getTopic: documentationOnly,
  createTopic: documentationOnly,
  updateTopic: documentationOnly,
  deleteTopic: documentationOnly,
  listOrganizations: documentationOnly,
  getOrganization: documentationOnly,
  createOrganization: documentationOnly,
  updateOrganization: documentationOnly,
  deleteOrganization: documentationOnly,
  listExperiences: documentationOnly,
  getExperience: documentationOnly,
  createExperience: documentationOnly,
  updateExperience: documentationOnly,
  deleteExperience: documentationOnly,
  listProjects: documentationOnly,
  getProject: documentationOnly,
  createProject: documentationOnly,
  updateProject: documentationOnly,
  deleteProject: documentationOnly,
  getCaseStudy: documentationOnly,
  createCaseStudy: documentationOnly,
  updateCaseStudy: documentationOnly,
  deleteCaseStudy: documentationOnly,
  listExplorations: documentationOnly,
  getExploration: documentationOnly,
  createExploration: documentationOnly,
  updateExploration: documentationOnly,
  deleteExploration: documentationOnly,
  listServices: documentationOnly,
  getService: documentationOnly,
  createService: documentationOnly,
  updateService: documentationOnly,
  deleteService: documentationOnly,
  listEducation: documentationOnly,
  getEducation: documentationOnly,
  createEducation: documentationOnly,
  updateEducation: documentationOnly,
  deleteEducation: documentationOnly,
  listTestimonials: documentationOnly,
  getTestimonial: documentationOnly,
  createTestimonial: documentationOnly,
  updateTestimonial: documentationOnly,
  deleteTestimonial: documentationOnly,
  listCurrentFocus: documentationOnly,
  getCurrentFocus: documentationOnly,
  createCurrentFocus: documentationOnly,
  updateCurrentFocus: documentationOnly,
  deleteCurrentFocus: documentationOnly,
};

/** A media service for describing routes; describing never calls it. */
const describingMedia: MediaService = {
  listMedia: documentationOnly,
  getMedia: documentationOnly,
  uploadMedia: documentationOnly,
  ensureMedia: documentationOnly,
  updateMedia: documentationOnly,
  deleteMedia: documentationOnly,
  readMediaFile: documentationOnly,
};

/** A roadmap service for describing routes; describing never calls it. */
const describingRoadmap: RoadmapService = {
  getRoadmap: documentationOnly,
  getAreaDetail: documentationOnly,
  getModuleDetail: documentationOnly,
  getCurrentLearning: documentationOnly,
  getStatistics: documentationOnly,
  getArea: documentationOnly,
  createArea: documentationOnly,
  updateArea: documentationOnly,
  deleteArea: documentationOnly,
  getModule: documentationOnly,
  createModule: documentationOnly,
  updateModule: documentationOnly,
  deleteModule: documentationOnly,
  getResource: documentationOnly,
  createResource: documentationOnly,
  updateResource: documentationOnly,
  deleteResource: documentationOnly,
  getDiary: documentationOnly,
  getDiaryDay: documentationOnly,
  getTimeEntry: documentationOnly,
  writeDiaryNotes: documentationOnly,
  deleteDiaryNotes: documentationOnly,
  createTimeEntry: documentationOnly,
  logSession: documentationOnly,
  updateTimeEntry: documentationOnly,
  deleteTimeEntry: documentationOnly,
  listBooks: documentationOnly,
  getBook: documentationOnly,
  createBook: documentationOnly,
  updateBook: documentationOnly,
  deleteBook: documentationOnly,
  listEvents: documentationOnly,
  getEvent: documentationOnly,
  createEvent: documentationOnly,
  updateEvent: documentationOnly,
  deleteEvent: documentationOnly,
  listProjectIdeas: documentationOnly,
  getProjectIdea: documentationOnly,
  createProjectIdea: documentationOnly,
  updateProjectIdea: documentationOnly,
  deleteProjectIdea: documentationOnly,
  listFollowedSources: documentationOnly,
  getFollowedSource: documentationOnly,
  createFollowedSource: documentationOnly,
  updateFollowedSource: documentationOnly,
  deleteFollowedSource: documentationOnly,
  listGlossaryTerms: documentationOnly,
  getGlossaryTerm: documentationOnly,
  createGlossaryTerm: documentationOnly,
  updateGlossaryTerm: documentationOnly,
  deleteGlossaryTerm: documentationOnly,
};

/** An audit service for describing routes; describing never calls it. */
const describingAudit: AuditService = {
  write: documentationOnly,
  recentChanges: documentationOnly,
};

/** A knowledge service for describing routes; describing never calls it. */
const describingKnowledge: KnowledgeService = {
  reindexPortfolio: documentationOnly,
  rebuildPortfolio: documentationOnly,
  schedule: documentationOnly,
  processPending: documentationOnly,
  pending: documentationOnly,
  search: documentationOnly,
  candidates: documentationOnly,
  usage: documentationOnly,
  ingestDocument: documentationOnly,
  listDocuments: documentationOnly,
  showDocument: documentationOnly,
  approveDocument: documentationOnly,
  rejectDocument: documentationOnly,
  withdrawDocument: documentationOnly,
  deleteDocument: documentationOnly,
  rebuildIndex: documentationOnly,
};

/**
 * The OpenAPI document that `createApp` serves at `/openapi.json`, built without services,
 * configuration or a database. Deterministic: the same routes and schemas give the same document.
 */
export function describeApi(): OpenApiDocument {
  return createOpenApiDocument(
    documentedRoutes(
      moduleRoutes({
        profile: describingProfile,
        media: describingMedia,
        roadmap: describingRoadmap,
        audit: describingAudit,
        knowledge: describingKnowledge,
      }),
    ),
  );
}

/** Served files load nothing, even when opened directly; sandboxed files also run no script. */
const FILE_POLICY = "default-src 'none'";
const SANDBOXED_FILE_POLICY = `${FILE_POLICY}; sandbox`;

const writeLog: Logger = (line) => {
  process.stdout.write(`${line}\n`);
};

/**
 * Composes the HTTP application. Has no side effects: it neither listens nor migrates.
 *
 * Every route is rate limited per client first. Private routes then verify the API key and count
 * against its budget before path parameters or a body are read; path parameters are validated
 * next, and body routes accept only bounded JSON that their schema validates, or upload routes a
 * bounded multipart form. Uploads draw from their own per-client budget instead of the private one.
 * File routes send their bytes with their own type and a sandboxing content security policy.
 * Failures use the common error shape; unknown routes are a public-limited 404.
 */
export function createApp(dependencies: AppDependencies): Api {
  const { services, config } = dependencies;
  const log = dependencies.log ?? writeLog;
  const onWrite: readonly WriteNotifier[] =
    dependencies.onWrite === undefined
      ? []
      : typeof dependencies.onWrite === "function"
        ? [dependencies.onWrite]
        : dependencies.onWrite;
  const limits = createRateLimits(config, dependencies.now ?? Date.now);
  const app = new Hono<ApiEnv>();
  const modules = moduleRoutes(services);
  const documented = documentedRoutes(modules);

  app.use(noSniff, requestLog(log));
  app.onError(handleErrors(log));

  // The checks in front of a route, in order: client budget, URL credentials, key, key budget,
  // path parameters, body.
  const guard = (route: RouteDocumentation): MiddlewareHandler<ApiEnv> =>
    every(
      limits.perClient(route.budget ?? route.access),
      refuseCredentialsInUrl,
      ...(route.access === "private" ? [authenticate(services.apiKeys), limits.perKey()] : []),
      ...(route.params ? [pathParams(route.params)] : []),
      ...(route.body ? jsonBody(route.body, config.bodyLimitBytes) : []),
      ...(route.upload
        ? multipartBody(route.upload.schema, route.upload.fileField, config.uploadLimitBytes)
        : []),
    );

  const notify = async (event: WriteEvent) => {
    for (const notifier of onWrite) {
      try {
        await notifier(event);
      } catch (error) {
        // The error's name only: a notifier's message may carry content or its destination.
        const name = error instanceof Error ? error.name : "error";
        log(redact(`error notifying ${event.method} ${event.path}: ${name}`));
      }
    }
  };

  const register = (route: RouteDefinition, index: number) => {
    if (writes(route) && !route.content) {
      throw new Error(`The write route ${route.operationId} declares no content domain.`);
    }
    const audit = auditOf(route);
    app.on(route.method, route.path, guard(route), async (c) => {
      const params = c.get("params");
      const body: unknown = c.get("body");
      const { method } = route;
      const result =
        method === "GET" || audit === null
          ? await route.handle({ body, params })
          : // The write and its audit commit together: the route runs over the services of the
            // audited write's transaction, as the actor the key verification established.
            await services.audit.write({
              actor: { keyId: c.get("keyId") },
              operation: { operationId: route.operationId, method, route: route.path },
              provenance: c.req.header(auditProvenanceHeader) ?? null,
              entity: audit.entity,
              records: audit.records(params, body),
              run: (content) => {
                const bound = moduleRoutes({
                  ...content,
                  audit: services.audit,
                  knowledge: services.knowledge,
                })[index];
                if (bound?.operationId !== route.operationId) {
                  throw new Error(
                    `The route ${route.operationId} is not bound in its transaction.`,
                  );
                }
                return bound.handle({ body, params });
              },
              recordsOf: (done) => audit.recordsOf?.(done) ?? [],
            });
      // Reached only once the write and its audit have committed; a failed write throws before it.
      if (writes(route)) {
        const changes = changesOf(route, params, result);
        if (changes) {
          for (const change of changes) {
            await notify({
              operationId: route.operationId,
              method: route.method,
              path: c.req.path,
              change,
            });
          }
        } else {
          log(redact(`error notifying ${route.method} ${c.req.path}: no content record`));
        }
      }
      if (route.response.location) {
        c.header("Location", fillLocation(route.response.location, result));
      }
      if (route.response.status === 204) return c.body(null, 204);
      if (route.response.file) {
        const file = result as FileResponse;
        return c.body(new Uint8Array(file.bytes), 200, {
          "content-type": file.mediaType,
          "content-security-policy": file.sandboxed ? SANDBOXED_FILE_POLICY : FILE_POLICY,
          "content-disposition": file.sandboxed ? "inline" : `inline; filename="${file.fileName}"`,
        });
      }
      return c.json(result, route.response.status);
    });
  };

  app.get("/health", guard(systemRoutes.health), (c) => c.json({ status: "ok" as const }));
  app.get(systemRoutes.readiness.path, guard(systemRoutes.readiness), async (c) => {
    c.header("Cache-Control", "no-store");
    if (!(await services.health.databaseReachable())) {
      throw new ApiError(503, "unavailable", "The database cannot be reached now.", undefined, {
        "Cache-Control": "no-store",
      });
    }
    return c.json({ status: "ready" as const });
  });
  app.get(systemRoutes.authentication.path, guard(systemRoutes.authentication), (c) =>
    c.json({ status: "authenticated" as const }),
  );

  modules.forEach(register);

  // Built on the first request and kept: building it costs more than the rest of the app.
  let document: OpenApiDocument | undefined;
  app.get("/openapi.json", guard(systemRoutes.openapi), (c) =>
    c.json((document ??= createOpenApiDocument(documented))),
  );
  app.get(
    "/reference",
    guard(systemRoutes.reference),
    Scalar({ url: systemRoutes.openapi.path, pageTitle: "Sebela API reference" }),
  );

  app.all("*", limits.perClient("public"), refuseCredentialsInUrl, () => {
    throw new ApiError(404, "not_found", "There is no such route.");
  });

  return {
    app,
    routes: documented.map((route) => ({
      method: route.method,
      path: route.path,
      access: route.access,
      hasBody: route.body !== undefined || route.upload !== undefined,
      audit: auditOf(route)?.entity ?? null,
    })),
  };
}
