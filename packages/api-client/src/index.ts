import createClient, { type Client, type Middleware } from "openapi-fetch";

import document from "./generated/openapi.json" with { type: "json" };
import type { components, paths } from "./generated/schema.js";

type Schemas = components["schemas"];

export type Person = Schemas["Person"];
export type PersonCreate = Schemas["PersonCreate"];
export type PersonUpdate = Schemas["PersonUpdate"];
export type PersonLink = Schemas["PersonLink"];
export type Health = Schemas["Health"];
export type ErrorResponse = Schemas["ErrorResponse"];
export type ErrorField = Schemas["ErrorField"];
export type ErrorCode = ErrorResponse["error"]["code"];

/** The client of every documented operation, typed by the API's OpenAPI document. */
export type ApiClient = Client<paths>;

export interface ApiClientOptions {
  /** The API's base address, from the consumer's environment. */
  readonly baseUrl: string;
  /** Server-side only. Sent as a bearer token to operations whose contract requires it. */
  readonly apiKey?: string;
  /** A `fetch` implementation; the global one by default. */
  readonly fetch?: (request: Request) => Promise<Response>;
}

/** What the client reads from the committed document: each operation's security requirement. */
interface DocumentedSecurity {
  readonly paths: Readonly<
    Record<string, Readonly<Record<string, { readonly security?: readonly object[] } | undefined>>>
  >;
}

const documented: DocumentedSecurity = document;

/**
 * Whether the contract requires credentials for the operation at `schemaPath` and `method`.
 * The API declares security per operation and none at the document level (`apps/api/src/openapi.ts`),
 * so a document-level `security` is not consulted; if the API ever adds one, extend this lookup
 * and the consumer contract tests together.
 */
function requiresKey(schemaPath: string, method: string): boolean {
  const security = documented.paths[schemaPath]?.[method.toLowerCase()]?.security;
  return security !== undefined && security.length > 0;
}

/**
 * A client of the API for one base address and, server-side, one API key.
 *
 * Every call returns `{ data, error, response }`: `data` is the documented success body, `error`
 * the common `ErrorResponse` of a documented failure, and `response` carries the status and
 * headers such as `Retry-After`. Calls do not throw for HTTP failures; a network failure rejects.
 * The key is attached as `Authorization: Bearer` only to operations whose OpenAPI security
 * requires it, so public reads never carry it. Each client keeps its own key; there is no
 * global state.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const { apiKey } = options;
  if (apiKey !== undefined) {
    const bearer: Middleware = {
      onRequest({ request, schemaPath }) {
        if (requiresKey(schemaPath, request.method)) {
          request.headers.set("Authorization", `Bearer ${apiKey}`);
        }
        return request;
      },
    };
    client.use(bearer);
  }
  return client;
}
