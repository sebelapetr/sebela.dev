/**
 * The expected failures of a domain operation. The API maps each code to its status and the common
 * error shape; anything else that is thrown is unexpected and becomes an internal error.
 *
 * - `not_found`: the addressed record does not exist.
 * - `conflict`: the operation contradicts existing content, for example a second person.
 * - `validation_failed`: an argument breaks a domain rule the caller could not check itself.
 * - `payload_too_large`: an uploaded file is larger than the configured limit.
 * - `unsupported_media_type`: an uploaded file is not an accepted type, or its declared type or
 *   extension contradicts its content.
 */
export type DomainErrorCode =
  "not_found" | "conflict" | "validation_failed" | "payload_too_large" | "unsupported_media_type";

/** An offending input field of a `validation_failed` refusal, named by its dotted path. */
export interface DomainErrorField {
  readonly path: string;
  readonly message: string;
}

export class DomainError extends Error {
  override readonly name = "DomainError";

  constructor(
    readonly code: DomainErrorCode,
    message: string,
    /** The offending fields of a `validation_failed` refusal, when it is about specific fields. */
    readonly fields?: readonly DomainErrorField[],
  ) {
    super(message);
  }
}
