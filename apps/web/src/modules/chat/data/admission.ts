// Why the API did not take a question in: the codes a transport reports before any answer event.

/**
 * Why a question was not admitted: the person check failed, another question is still answered,
 * the request was already used for another question, the visitor's or the site's allowance is
 * spent, too many requests came in a short time, the question was not accepted, or the assistant
 * could not be reached.
 */
export const chatAdmissionCodes = [
  "challenge_failed",
  "busy",
  "conflict",
  "quota_exceeded",
  "budget_exhausted",
  "rate_limited",
  "invalid_request",
  "unavailable",
] as const;

export type ChatAdmissionCode = (typeof chatAdmissionCodes)[number];

/**
 * Thrown by a transport when the question was not admitted; no answer was started, so nothing was
 * stored. `retryAfterSeconds` is the API's `Retry-After`, when it sent one.
 */
export class ChatAdmissionError extends Error {
  readonly code: ChatAdmissionCode;
  readonly retryAfterSeconds: number | null;

  constructor(code: ChatAdmissionCode, retryAfterSeconds: number | null = null) {
    super(`The question was not admitted: ${code}.`);
    this.name = "ChatAdmissionError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
