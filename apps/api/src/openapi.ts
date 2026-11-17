import {
  createDocument,
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathsObject,
} from "zod-openapi";

import { ErrorResponseSchema } from "@sebela/contracts";

import { PARAMETER, type RouteDocumentation } from "./routing.js";

const errorContent = { "application/json": { schema: ErrorResponseSchema } };

const error = (description: string, extra: object = {}) => ({
  description,
  content: errorContent,
  ...extra,
});

function responses(route: RouteDocumentation): ZodOpenApiOperationObject["responses"] {
  const { response } = route;
  const binary = { schema: { type: "string" as const, format: "binary" } };
  const success = response.file
    ? { content: Object.fromEntries(response.file.map((type) => [type, binary])) }
    : response.schema
      ? { content: { [response.mediaType ?? "application/json"]: { schema: response.schema } } }
      : response.mediaType
        ? { content: { [response.mediaType]: {} } }
        : {};
  const location = response.location
    ? {
        headers: {
          Location: {
            description: "The address of the record.",
            schema: { type: "string" as const },
          },
        },
      }
    : {};
  return {
    [String(response.status)]: { description: response.description, ...success, ...location },
    "400": error(badRequest(route)),
    ...(route.access === "private"
      ? {
          "401": error("`unauthorized`: the API key is missing, malformed, unknown or revoked.", {
            headers: {
              "WWW-Authenticate": { description: "`Bearer`.", schema: { type: "string" as const } },
            },
          }),
        }
      : {}),
    ...(route.errors.includes("not_found")
      ? { "404": error("`not_found`: the record does not exist.") }
      : {}),
    ...(route.errors.includes("conflict")
      ? { "409": error("`conflict`: the write contradicts existing content.") }
      : {}),
    ...(route.body
      ? {
          "413": error("`payload_too_large`: the body exceeds the configured limit."),
          "415": error("`unsupported_media_type`: the body is not `application/json`."),
        }
      : {}),
    ...(route.upload
      ? {
          "413": error("`payload_too_large`: the file or the form exceeds the configured limit."),
          "415": error(
            "`unsupported_media_type`: the body is not `multipart/form-data`, or the file is not an " +
              "accepted type or contradicts its declared type or extension.",
          ),
        }
      : {}),
    "429": error("`rate_limited`: a rate-limit budget is exhausted.", {
      headers: {
        "Retry-After": {
          description: "Seconds until the budget is renewed.",
          schema: { type: "integer" as const },
        },
      },
    }),
    "500": error("`internal_error`: an unexpected failure, without details."),
  };
}

/** What a 400 of the route can mean: only the checks the route actually runs. */
function badRequest(route: RouteDocumentation): string {
  const invalid = [
    ...(route.params ? ["a malformed path parameter"] : []),
    ...(route.body ? ["an invalid body or a broken domain rule"] : []),
    ...(route.upload ? ["an invalid form, a malformed file or an image over the size limit"] : []),
  ];
  return [
    ...(route.body ? ["`malformed_json`"] : []),
    ...(invalid.length > 0
      ? [`\`validation_failed\` (${invalid.join(" or ")}, with \`fields\`)`]
      : []),
    "`credentials_in_url` (a credential was sent in the query string)",
  ].join(", ");
}

function operation(route: RouteDocumentation): ZodOpenApiOperationObject {
  return {
    operationId: route.operationId,
    summary: route.summary,
    ...(route.description ? { description: route.description } : {}),
    security: route.access === "private" ? [{ bearerAuth: [] }] : [],
    ...(route.params ? { requestParams: { path: route.params } } : {}),
    ...(route.body
      ? { requestBody: { required: true, content: { "application/json": { schema: route.body } } } }
      : {}),
    ...(route.upload
      ? {
          requestBody: {
            required: true,
            content: { "multipart/form-data": { schema: route.upload.schema } },
          },
        }
      : {}),
    responses: responses(route),
  };
}

/** The OpenAPI 3.1 document of the given routes, generated from their contract schemas. */
export function createOpenApiDocument(
  routes: readonly RouteDocumentation[],
): ReturnType<typeof createDocument> {
  const paths: ZodOpenApiPathsObject = {};
  for (const route of routes) {
    const path = route.path.replace(PARAMETER, "{$1}");
    paths[path] = { ...paths[path], [route.method.toLowerCase()]: operation(route) };
  }
  return createDocument({
    openapi: "3.1.0",
    info: {
      title: "Sebela API",
      version: "1",
      description:
        "The content API of sebelapetr.cz. Reads are public; every write needs an API key, sent " +
        "as `Authorization: Bearer <key>` and never in the URL. Every route is rate limited and " +
        "answers failures with the common error shape. `GET /health` reports liveness only.",
    },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "An API key created with the `api-keys` command of the API package.",
        },
      },
    },
  });
}
