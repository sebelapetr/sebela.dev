import { Scalar } from "@scalar/hono-api-reference";
import { Hono, type MiddlewareHandler } from "hono";
import { every } from "hono/combine";
import { z } from "zod";

import type { ProfileService, Services } from "@sebela/services";

import type { ApiConfig } from "./config.js";
import { authenticate, refuseCredentialsInUrl } from "./middleware/authentication.js";
import type { ApiEnv } from "./middleware/context.js";
import { ApiError, handleErrors } from "./middleware/errors.js";
import { jsonBody } from "./middleware/json-body.js";
import { pathParams } from "./middleware/path-params.js";
import { createRateLimits } from "./middleware/limits.js";
import { noSniff, redact, requestLog, type Logger } from "./middleware/logging.js";
import { profileRoutes } from "./modules/profile/index.js";
import { createOpenApiDocument } from "./openapi.js";
import { fillLocation, type RouteDefinition, type RouteDocumentation } from "./routing.js";

export type { Logger };

/** What a successful write reports to the attachment point for interested parties. */
export interface WriteEvent {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
}

export type WriteNotifier = (event: WriteEvent) => Promise<void>;

export interface AppDependencies {
  readonly services: Pick<Services, "profile" | "apiKeys">;
  readonly config: ApiConfig;
  /** Milliseconds since the epoch, for rate-limit windows. */
  readonly now?: () => number;
  readonly log?: Logger;
  /** Called after every successful write; a failure is logged and never fails the write. */
  readonly onWrite?: WriteNotifier;
}

/** A route as it is registered and documented. */
export interface RouteSummary {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly access: "public" | "private";
  /** Whether the route reads a JSON body. */
  readonly hasBody: boolean;
}

export interface Api {
  readonly app: Hono<ApiEnv>;
  readonly routes: readonly RouteSummary[];
}

const HealthSchema = z.object({ status: z.literal("ok") }).meta({ id: "Health" });

const systemRoutes = {
  health: {
    operationId: "getHealth",
    method: "GET",
    path: "/health",
    access: "public",
    summary: "Liveness",
    description: "Answers while the process runs; it does not check the database. Its own budget.",
    response: { status: 200, description: "The API is running.", schema: HealthSchema },
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
const moduleRoutes = (services: Pick<Services, "profile">): RouteDefinition[] => [
  ...profileRoutes(services.profile),
];

/** Every documented route, in the order of the OpenAPI document. */
const documentedRoutes = (modules: readonly RouteDefinition[]): RouteDocumentation[] => [
  systemRoutes.health,
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
};

/**
 * The OpenAPI document that `createApp` serves at `/openapi.json`, built without services,
 * configuration or a database. Deterministic: the same routes and schemas give the same document.
 */
export function describeApi(): OpenApiDocument {
  return createOpenApiDocument(documentedRoutes(moduleRoutes({ profile: describingProfile })));
}

const writeLog: Logger = (line) => {
  process.stdout.write(`${line}\n`);
};

/**
 * Composes the HTTP application. Has no side effects: it neither listens nor migrates.
 *
 * Every route is rate limited per client first. Private routes then verify the API key and count
 * against its budget before path parameters or a body are read; path parameters are validated
 * next, and body routes accept only bounded JSON that their schema validates. Failures use the common error shape; unknown routes are a public-limited 404.
 */
export function createApp(dependencies: AppDependencies): Api {
  const { services, config } = dependencies;
  const log = dependencies.log ?? writeLog;
  const onWrite = dependencies.onWrite ?? (() => Promise.resolve());
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
      limits.perClient(route === systemRoutes.health ? "health" : route.access),
      refuseCredentialsInUrl,
      ...(route.access === "private" ? [authenticate(services.apiKeys), limits.perKey()] : []),
      ...(route.params ? [pathParams(route.params)] : []),
      ...(route.body ? jsonBody(route.body, config.bodyLimitBytes) : []),
    );

  const notify = async (event: WriteEvent) => {
    try {
      await onWrite(event);
    } catch (error) {
      log(redact(`error notifying ${event.method} ${event.path}: ${String(error)}`));
    }
  };

  const register = (route: RouteDefinition) => {
    app.on(route.method, route.path, guard(route), async (c) => {
      const result = await route.handle({ body: c.get("body"), params: c.get("params") });
      if (route.method !== "GET") {
        await notify({ operationId: route.operationId, method: route.method, path: c.req.path });
      }
      if (route.response.location) {
        c.header("Location", fillLocation(route.response.location, result));
      }
      if (route.response.status === 204) return c.body(null, 204);
      return c.json(result, route.response.status);
    });
  };

  app.get("/health", guard(systemRoutes.health), (c) => c.json({ status: "ok" as const }));

  for (const route of modules) register(route);

  const document: OpenApiDocument = createOpenApiDocument(documented);
  app.get("/openapi.json", guard(systemRoutes.openapi), (c) => c.json(document));
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
    routes: documented.map(({ method, path, access, body }) => ({
      method,
      path,
      access,
      hasBody: body !== undefined,
    })),
  };
}
