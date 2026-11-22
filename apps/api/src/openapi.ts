import {
  createDocument,
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathsObject,
} from "zod-openapi";

import { z } from "zod";

import {
  AuditProvenanceSchema,
  ErrorResponseSchema,
  auditProvenanceHeader,
} from "@sebela/contracts";

import { PARAMETER, type RouteDocumentation } from "./routing.js";

/** The optional label of the tool or client that makes an audited write. */
const ProvenanceHeaderSchema = z.object({
  [auditProvenanceHeader]: AuditProvenanceSchema.optional().meta({
    description:
      "A short label of the tool or client making the write, such as `mcp-admin/update_content`, " +
      "stored with its audit. Stated by the caller: never proof of who acted or that a human " +
      "approved. A label outside the pattern is refused with `validation_failed` on `provenance`.",
  }),
});

/** Every write is audited: it changes content, which the app commits together with its audit. */
const audited = (route: RouteDocumentation) =>
  route.method !== "GET" && route.readOnly !== true && route.content !== undefined;

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
  const headers = {
    ...(response.location
      ? {
          Location: {
            description: "The address of the record.",
            schema: { type: "string" as const },
          },
        }
      : {}),
    ...(route.cookie
      ? {
          "Set-Cookie": {
            description:
              `\`${route.cookie.name}\`, only when a new identity was issued: HttpOnly, ` +
              "SameSite=Lax, Path=/, Secure in production, for the retention period.",
            schema: { type: "string" as const },
          },
        }
      : {}),
  };
  const withHeaders = Object.keys(headers).length > 0 ? { headers } : {};
  const { refusals = {} } = route;
  return {
    [String(response.status)]: { description: response.description, ...success, ...withHeaders },
    ...(response.also
      ? {
          [String(response.also.status)]: {
            description: response.also.description,
            ...success,
            ...withHeaders,
          },
        }
      : {}),
    "400": error(badRequest(route)),
    ...(route.access === "private"
      ? {
          "401": error(
            route.authorization === "control"
              ? "`unauthorized`: the control token is missing or wrong; no API key is accepted."
              : "`unauthorized`: the API key is missing, malformed, unknown or revoked.",
            {
              headers: {
                "WWW-Authenticate": {
                  description: "`Bearer`.",
                  schema: { type: "string" as const },
                },
              },
            },
          ),
        }
      : {}),
    ...(refusals[403] ? { "403": error(refusals[403]) } : {}),
    ...(refusals[404]
      ? { "404": error(refusals[404]) }
      : route.errors.includes("not_found")
        ? { "404": error("`not_found`: the record does not exist.") }
        : {}),
    ...(refusals[409]
      ? { "409": error(refusals[409]) }
      : route.errors.includes("conflict")
        ? { "409": error("`conflict`: the write contradicts existing content.") }
        : {}),
    ...(route.body
      ? {
          "413": error("`payload_too_large`: the body exceeds the configured limit."),
          ...(route.sameOrigin
            ? {}
            : { "415": error("`unsupported_media_type`: the body is not `application/json`.") }),
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
    "429": error(
      refusals[429]
        ? `\`rate_limited\`: a rate-limit budget is exhausted; ${refusals[429]}`
        : "`rate_limited`: a rate-limit budget is exhausted.",
      {
        headers: {
          "Retry-After": {
            description: "Seconds until the budget is renewed.",
            schema: { type: "integer" as const },
          },
        },
      },
    ),
    "500": error("`internal_error`: an unexpected failure, without details."),
    ...(refusals[503]
      ? { "503": error(refusals[503]) }
      : route.errors.includes("provider_unavailable")
        ? {
            "503": error(
              "`provider_unavailable`: an outside provider the route needs is not configured, failed " +
                "or did not answer in time; `budget_exhausted`: the month's spend on it reached its " +
                "ceiling. Never reported as an empty result.",
            ),
          }
        : route.errors.includes("unavailable")
          ? { "503": error("`unavailable`: the database cannot be reached now, without details.") }
          : {}),
  };
}

/** What a 400 of the route can mean: only the checks the route actually runs. */
function badRequest(route: RouteDocumentation): string {
  const invalid = [
    ...(route.params ? ["a malformed path parameter"] : []),
    ...(route.query ? ["an unknown or invalid query parameter"] : []),
    ...(route.body ? ["an invalid body or a broken domain rule"] : []),
    ...(route.upload ? ["an invalid form, a malformed file or an image over the size limit"] : []),
    ...(audited(route) ? [`an invalid \`${auditProvenanceHeader}\` header`] : []),
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
    security:
      route.access === "private"
        ? [route.authorization === "control" ? { controlToken: [] } : { bearerAuth: [] }]
        : [],
    ...(route.params || route.query || route.headers || route.cookie || audited(route)
      ? {
          requestParams: {
            ...(route.params ? { path: route.params } : {}),
            ...(route.query ? { query: route.query } : {}),
            ...(audited(route) || route.headers
              ? {
                  header: route.headers
                    ? z.object({
                        ...(audited(route) ? ProvenanceHeaderSchema.shape : {}),
                        ...route.headers.shape,
                      })
                    : ProvenanceHeaderSchema,
                }
              : {}),
            ...(route.cookie
              ? {
                  cookie: z.object({
                    [route.cookie.name]: z
                      .string()
                      .optional()
                      .meta({ description: route.cookie.description }),
                  }),
                }
              : {}),
          },
        }
      : {}),
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
        "answers failures with the common error shape. `GET /health` reports liveness only. The one " +
        "exception: a visitor asks the chat over the cookie-authorised `/v1/chat` routes, which " +
        "accept only the website's origin; the AI service reports back over the internal control " +
        "routes with its own control token.",
    },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "An API key created with the `api-keys` command of the API package.",
        },
        controlToken: {
          type: "http",
          scheme: "bearer",
          description:
            "The AI service's control token (`API_AI_CONTROL_TOKEN`), accepted on the internal chat " +
            "control routes only; no API key is accepted there and the token is accepted nowhere else.",
        },
      },
    },
  });
}
