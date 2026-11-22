import { z } from "zod";

/**
 * Every machine-readable error code the API returns, with the status it is always sent with:
 *
 * - `validation_failed` (400): a body, path or query value broke its schema; `fields` names them.
 * - `malformed_json` (400): the body is not parseable JSON.
 * - `credentials_in_url` (400): a credential-like query parameter was sent; keys go in the
 *   `Authorization` header only.
 * - `unauthorized` (401): a private route without a valid API key. Missing, malformed, unknown and
 *   revoked keys are indistinguishable.
 * - `not_found` (404): no such route or record.
 * - `conflict` (409): the write contradicts existing content, for example a second person.
 * - `payload_too_large` (413): the body or an uploaded file exceeds its configured limit.
 * - `unsupported_media_type` (415): the body is not of the type the route accepts (`application/json`,
 *   or `multipart/form-data` for an upload), or an uploaded file is not an accepted type, or its
 *   declared type or extension does not match its content.
 * - `rate_limited` (429): a rate-limit budget is exhausted; `Retry-After` says when to retry.
 * - `internal_error` (500): an unexpected failure. No stack, SQL or secret is included.
 * - `provider_unavailable` (503): an outside provider the operation needs, such as the embedding
 *   provider of a search, is not configured, failed or timed out. Never reported as no result.
 * - `budget_exhausted` (503): the month's spend on an outside provider reached its ceiling.
 * - `unavailable` (503): something the API depends on, such as the database, cannot be reached now;
 *   the readiness check answers it. No detail of the failure is included.
 * - `forbidden` (403): a visitor chat write from another origin or without a JSON body, or an
 *   internal generation result carrying another grant. Refused before any state changes.
 * - `chat_request_conflict` (409): a chat request identifier reused for a different question.
 * - `chat_busy` (409): the visitor already has an answer in progress.
 * - `chat_challenge_failed` (403): the bot challenge was missing, invalid, expired or already
 *   used; a new challenge may succeed. No question was admitted.
 * - `chat_quota_exceeded` (429): the visitor or the address reached a question quota;
 *   `Retry-After` says when to retry.
 * - `chat_budget_exhausted` (503): the chat's global daily or monthly spend is reserved in full.
 */
export const errorCodes = [
  "validation_failed",
  "malformed_json",
  "credentials_in_url",
  "unauthorized",
  "not_found",
  "conflict",
  "payload_too_large",
  "unsupported_media_type",
  "rate_limited",
  "internal_error",
  "provider_unavailable",
  "budget_exhausted",
  "unavailable",
  "forbidden",
  "chat_request_conflict",
  "chat_busy",
  "chat_challenge_failed",
  "chat_quota_exceeded",
  "chat_budget_exhausted",
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export const ErrorFieldSchema = z
  .object({
    path: z.string().meta({ description: "Dot-separated path of the field, empty for the body." }),
    message: z.string(),
  })
  .meta({ id: "ErrorField" });

/** The one shape of every error response of the API. */
export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.enum(errorCodes),
      message: z.string(),
      fields: z.array(ErrorFieldSchema).optional(),
    }),
  })
  .meta({ id: "ErrorResponse", description: "The common error shape of every failed request." });

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
