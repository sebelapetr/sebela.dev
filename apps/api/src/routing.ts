import type { z } from "zod";

import type { ApiConfig } from "./config.js";

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

/** Which per-client budget a route draws from; private routes also draw from the per-key one. */
export type RateBudget = keyof Omit<ApiConfig["rateLimits"], "key" | "maxTrackedCallers">;

/** The domain errors a route can answer with, beyond the errors every route shares. */
export type RouteError = "not_found" | "conflict";

/** What the OpenAPI document says about a route. */
export interface RouteDocumentation {
  readonly operationId: string;
  readonly method: Method;
  /** Hono syntax, `:name` for a parameter. */
  readonly path: string;
  readonly access: "public" | "private";
  readonly summary: string;
  readonly description?: string;
  /** The JSON request body; validated before the handler runs. */
  readonly body?: z.ZodType;
  readonly response: {
    readonly status: 200 | 201 | 204;
    readonly description: string;
    readonly schema?: z.ZodType;
    /** Media type of a non-JSON success, for example the HTML reference. */
    readonly mediaType?: string;
    /** A fixed `Location` header sent with the success. */
    readonly location?: string;
  };
  readonly errors: readonly RouteError[];
}

/** A JSON route as a module contributes it: its documentation and what it does. */
export interface RouteDefinition extends RouteDocumentation {
  /** Runs the operation; the result is sent as the JSON success body. */
  handle(input: { readonly body: unknown }): Promise<unknown>;
}

/**
 * Declares a route whose handler receives the parsed output of its body schema. The body type is
 * erased afterwards: the app validates with exactly this schema before it calls `handle`.
 */
export function defineRoute<Body = undefined>(
  route: Omit<RouteDefinition, "body" | "handle"> & {
    readonly body?: z.ZodType<Body>;
    handle(input: { readonly body: Body }): Promise<unknown>;
  },
): RouteDefinition {
  return route;
}
