// Turns the bytes of a supplemental Markdown or plain-text document into an indexable source:
// checked for type and limits, decoded as UTF-8, cleaned, checked locally for sensitive values and
// split by headings into sections and bounded, overlapping chunks. Nothing here calls a provider.
import type { SourceChunk, SourceSection } from "../ingest/index.js";

/** The kinds of sensitive value a local check finds. A finding never carries the value. */
export const sensitivityKinds = [
  "private_key",
  "connection_string",
  "credential",
  "email",
  "national_identifier",
  "bank_account",
  "telephone",
] as const;
export type SensitivityKind = (typeof sensitivityKinds)[number];

/** Where a sensitive value was found: its kind and its line in the cleaned text (title: 0). */
export interface SensitivityFinding {
  readonly kind: SensitivityKind;
  readonly line: number;
}

export type DocumentMediaType = "text/markdown" | "text/plain";
export type DocumentExtension = "md" | "txt";

export interface DocumentLimits {
  /** The most bytes of the original. */
  readonly maxBytes: number;
  /** The most characters of the cleaned text. */
  readonly maxExtractedChars: number;
  /** The most milliseconds the preparation may take. */
  readonly maxProcessingMs: number;
}

export const defaultDocumentLimits: DocumentLimits = {
  maxBytes: 1_048_576,
  maxExtractedChars: 500_000,
  maxProcessingMs: 10_000,
};

/** Why a document cannot be prepared; each comes with a message saying what to do. */
export type DocumentRejection =
  | "invalid_slug"
  | "invalid_title"
  | "unsupported_type"
  | "not_utf8"
  | "empty"
  | "too_large"
  | "extracted_too_large"
  | "too_slow";

export class DocumentRejectedError extends Error {
  constructor(
    readonly reason: DocumentRejection,
    message: string,
  ) {
    super(message);
    this.name = "DocumentRejectedError";
  }
}

/** A document ready for the owner's preview and, once approved, for embedding. */
export interface PreparedDocument {
  /** `document:<slug>`. */
  readonly sourceId: string;
  /** The display title the owner chose; never derived from the file name. */
  readonly title: string;
  readonly mediaType: DocumentMediaType;
  readonly extension: DocumentExtension;
  /** SHA-256 of the original bytes, hex: what an approval is bound to. */
  readonly contentHash: string;
  /** The cleaned text. */
  readonly text: string;
  readonly sections: readonly SourceSection[];
  readonly chunks: readonly SourceChunk[];
  /** Empty when the document may be approved. */
  readonly findings: readonly SensitivityFinding[];
}

export interface DocumentInput {
  readonly slug: string;
  readonly title: string;
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

export interface PrepareOptions {
  readonly limits?: DocumentLimits;
  /** Milliseconds of a monotonic clock; tests pass a stepping one. */
  readonly clock?: () => number;
}

const notImplemented = (): never => {
  throw new Error("not implemented");
};

/** The source ID of a document slug, or `null` when the slug is not lower-case words and hyphens. */
export const documentSourceId: (slug: string) => string | null = notImplemented;

/** The extension and media type a file name stands for, or `null` when it is not supported. */
export const documentTypeOf: (
  fileName: string,
) => { readonly extension: DocumentExtension; readonly mediaType: DocumentMediaType } | null =
  notImplemented;

/** SHA-256 of the bytes, hex. */
export const contentHashOf: (bytes: Uint8Array) => string = notImplemented;

/**
 * Prepares a document. Throws `DocumentRejectedError` for an invalid slug or title, an unsupported
 * type, bytes that are not UTF-8 text, an empty text and every exceeded limit. Sensitive values do
 * not throw: they are returned as findings, without the values.
 */
export const prepareDocument: (input: DocumentInput, options?: PrepareOptions) => PreparedDocument =
  notImplemented;
