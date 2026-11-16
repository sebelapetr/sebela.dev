/**
 * The expected failures of a domain operation. The API maps each code to its status and the common
 * error shape; anything else that is thrown is unexpected and becomes an internal error.
 *
 * - `not_found`: the addressed record does not exist.
 * - `conflict`: the operation contradicts existing content, for example a second person.
 * - `validation_failed`: an argument breaks a domain rule the caller could not check itself.
 */
export type DomainErrorCode = "not_found" | "conflict" | "validation_failed";

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
