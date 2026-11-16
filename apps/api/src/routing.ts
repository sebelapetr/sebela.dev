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
  /** The path parameters, `:name` in `path`; validated before the body. */
  readonly params?: z.ZodObject;
  /** The JSON request body; validated before the handler runs. */
  readonly body?: z.ZodType;
  readonly response: {
    readonly status: 200 | 201 | 204;
    readonly description: string;
    readonly schema?: z.ZodType;
    /** Media type of a non-JSON success, for example the HTML reference. */
    readonly mediaType?: string;
    /**
     * The `Location` header sent with the success. `:name` is filled with the URI-encoded `name`
     * property of the result, for example `/v1/topics/:slug`.
     */
    readonly location?: string;
  };
  readonly errors: readonly RouteError[];
}

/** A JSON route as a module contributes it: its documentation and what it does. */
export interface RouteDefinition extends RouteDocumentation {
  /** Runs the operation; the result is sent as the JSON success body. */
  handle(input: { readonly body: unknown; readonly params: unknown }): Promise<unknown>;
}

/**
 * Declares a route whose handler receives the parsed output of its body and path-parameter
 * schemas. The types are erased afterwards: the app validates with exactly these schemas before it
 * calls `handle`.
 */
export function defineRoute<Body = undefined, Params = undefined>(
  route: Omit<RouteDefinition, "body" | "params" | "handle"> & {
    readonly body?: z.ZodType<Body>;
    readonly params?: z.ZodObject & z.ZodType<Params>;
    handle(input: { readonly body: Body; readonly params: Params }): Promise<unknown>;
  },
): RouteDefinition {
  return route;
}

/** The `Location` of a created record: the template with each `:name` taken from the result. */
export function fillLocation(template: string, result: unknown): string {
  return template.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value: unknown =
      typeof result === "object" && result !== null ? Reflect.get(result, name) : "";
    return encodeURIComponent(String(value));
  });
}
