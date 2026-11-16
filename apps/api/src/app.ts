import { Scalar } from "@scalar/hono-api-reference";
import { Hono, type MiddlewareHandler } from "hono";
import { every } from "hono/combine";
import { z } from "zod";

import type { Services } from "@sebela/services";

import type { ApiConfig } from "./config.js";
import { authenticate, refuseCredentialsInUrl } from "./middleware/authentication.js";
import type { ApiEnv } from "./middleware/context.js";
import { ApiError, handleErrors } from "./middleware/errors.js";
import { jsonBody } from "./middleware/json-body.js";
import { createRateLimits } from "./middleware/limits.js";
import { noSniff, redact, requestLog, type Logger } from "./middleware/logging.js";
import { profileRoutes } from "./modules/profile/index.js";
import { createOpenApiDocument } from "./openapi.js";
import type { RouteDefinition, RouteDocumentation } from "./routing.js";

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

const writeLog: Logger = (line) => {
  process.stdout.write(`${line}\n`);
};

/**
 * Composes the HTTP application. Has no side effects: it neither listens nor migrates.
 *
 * Every route is rate limited per client first. Private routes then verify the API key and count
 * against its budget before a body is read; body routes accept only bounded JSON that their schema
 * validates. Failures use the common error shape; unknown routes are a public-limited 404.
 */
export function createApp(dependencies: AppDependencies): Api {
  const { services, config } = dependencies;
  const log = dependencies.log ?? writeLog;
  const onWrite = dependencies.onWrite ?? (() => Promise.resolve());
  const limits = createRateLimits(config, dependencies.now ?? Date.now);
  const app = new Hono<ApiEnv>();
  const documented: RouteDocumentation[] = [];

  app.use(noSniff, requestLog(log));
  app.onError(handleErrors(log));

  // The checks in front of a route, in order: client budget, URL credentials, key, key budget, body.
  const guard = (route: RouteDocumentation): MiddlewareHandler<ApiEnv> =>
    every(
      limits.perClient(route === systemRoutes.health ? "health" : route.access),
      refuseCredentialsInUrl,
      ...(route.access === "private" ? [authenticate(services.apiKeys), limits.perKey()] : []),
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
    documented.push(route);
    app.on(route.method, route.path, guard(route), async (c) => {
      const result = await route.handle({ body: c.get("body") });
      if (route.method !== "GET") {
        await notify({ operationId: route.operationId, method: route.method, path: c.req.path });
      }
      if (route.response.location) c.header("Location", route.response.location);
      if (route.response.status === 204) return c.body(null, 204);
      return c.json(result, route.response.status);
    });
  };

  documented.push(systemRoutes.health);
  app.get("/health", guard(systemRoutes.health), (c) => c.json({ status: "ok" as const }));

  for (const route of profileRoutes(services.profile)) register(route);

  documented.push(systemRoutes.openapi, systemRoutes.reference);
  const document = createOpenApiDocument(documented);
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
