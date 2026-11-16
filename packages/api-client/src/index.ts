import type { Client } from "openapi-fetch";

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

export function createApiClient(options: ApiClientOptions): ApiClient {
  throw new Error(`Not implemented: ${options.baseUrl}`);
}
