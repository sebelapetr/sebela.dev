import type { z } from "zod";

import type { AuditEntity, ContentDomain } from "@sebela/contracts";

import type { ApiConfig } from "./config.js";

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

/** Which per-client budget a route draws from; private routes also draw from the per-key one. */
export type RateBudget = keyof Omit<ApiConfig["rateLimits"], "key" | "maxTrackedCallers">;

/** The domain errors a route can answer with, beyond the errors every route shares. */
export type RouteError = "not_found" | "conflict" | "unavailable";

/** What the OpenAPI document says about a route. */
export interface RouteDocumentation {
  readonly operationId: string;
  readonly method: Method;
  /** Hono syntax, `:name` for a parameter. */
  readonly path: string;
  readonly access: "public" | "private";
  readonly summary: string;
  readonly description?: string;
  /** The per-client budget, when it is not the one of its access, for example `upload`. */
  readonly budget?: RateBudget;
  /**
   * The content domain a write route changes, required on every write. After the write commits, the
   * app reports it with the record from the `slug` or `id` path parameter or the result, or with
   * each record the route's `records` names.
   */
  readonly content?: ContentDomain;
  /** The path parameters, `:name` in `path`; validated before the body. */
  readonly params?: z.ZodObject;
  /** The JSON request body; validated before the handler runs. */
  readonly body?: z.ZodType;
  /**
   * A `multipart/form-data` body instead of JSON: `schema` documents the form, `fileField` names its
   * one file part. The handler receives the other fields validated and the file as an `UploadedFile`.
   */
  readonly upload?: { readonly schema: z.ZodObject; readonly fileField: string };
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
    /**
     * The media types of a binary success. The handler returns a `FileResponse`, which is sent with
     * its own type, `Content-Disposition: inline` and a content security policy that loads nothing.
     */
    readonly file?: readonly string[];
  };
  readonly errors: readonly RouteError[];
}

/** The file part of a multipart body, as the handler receives it. */
export interface UploadedFile {
  readonly bytes: Uint8Array;
  /** The name the client sent; informational only, never a destination. */
  readonly filename: string;
  /** The type the client declared for the part; may be empty. */
  readonly declaredType: string;
}

/** The success of a route with a binary `response.file`. */
export interface FileResponse {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  /**
   * Whether the policy adds `sandbox`. A file a browser renders with a built-in viewer that the
   * sandbox stops, such as a PDF, is sent without it and names its file instead.
   */
  readonly sandboxed: boolean;
  /** The file name offered with an unsandboxed file; it must be a safe, unquoted name. */
  readonly fileName: string;
}

/**
 * How a write route's changes are audited when the default does not name them. By default a write
 * is audited as its content domain, for the person or the record its `slug`, `id` or `date` path
 * parameter names, or else the record the result's `slug` or `id` names.
 */
export interface RouteAudit<Params = unknown, Result = unknown, Body = unknown> {
  readonly entity: AuditEntity;
  /**
   * The records the write addresses before it runs, from its path parameters or its validated body
   * (such as the diary days a session will write); none for a create.
   */
  records(params: Params, body: Body): readonly (string | null)[];
  /** Further records only the result names, such as the entries a write created. */
  recordsOf?(result: Result): readonly (string | null)[];
}

/** A route as a module contributes it: its documentation and what it does. */
export interface RouteDefinition extends RouteDocumentation {
  /** Runs the operation; the result is sent as the JSON success body, or as a file. */
  handle(input: { readonly body: unknown; readonly params: unknown }): Promise<unknown>;
  /**
   * The records of the route's content domain a committed write changed, when one write changes
   * several, for example every diary day a time entry left or entered. The app reports each one.
   */
  records?(input: { readonly params: unknown; readonly result: unknown }): readonly string[];
  /** The audit of a write route when its default does not fit. */
  readonly audit?: RouteAudit;
}

/**
 * Declares a route whose handler receives the parsed output of its body and path-parameter
 * schemas, and whose `records` and `audit` receive those parameters and the handler's result. The types are
 * erased afterwards: the app validates with exactly these schemas before it
 * calls `handle`.
 */
export function defineRoute<Body = undefined, Params = undefined, Result = unknown>(
  route: Omit<RouteDefinition, "body" | "params" | "handle" | "records" | "audit"> & {
    readonly body?: z.ZodType<Body>;
    readonly params?: z.ZodObject & z.ZodType<Params>;
    handle(input: { readonly body: Body; readonly params: Params }): Promise<Result>;
    records?(input: { readonly params: Params; readonly result: Result }): readonly string[];
    readonly audit?: RouteAudit<NoInfer<Params>, NoInfer<Result>, NoInfer<Body>>;
  },
): RouteDefinition {
  return route;
}

/** A `:name` path parameter, with an optional Hono pattern such as `{.+}`. */
export const PARAMETER = /:([A-Za-z]+)(?:\{[^}]*\})?/g;

/** The `Location` of a created record: the template with each `:name` taken from the result. */
export function fillLocation(template: string, result: unknown): string {
  return template.replace(PARAMETER, (_, name: string) => {
    const value: unknown =
      typeof result === "object" && result !== null ? Reflect.get(result, name) : "";
    return encodeURIComponent(String(value));
  });
}
