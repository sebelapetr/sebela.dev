// Turns the bytes of a supplemental Markdown or plain-text document into an indexable source:
// checked for type and limits, decoded as UTF-8, cleaned, checked locally for sensitive values and
// split by headings into sections and bounded, overlapping chunks. Nothing here calls a provider.
import { createHash } from "node:crypto";

import { chunkMaxLength, type SourceChunk, type SourceSection } from "../ingest/index.js";

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

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const maxSlugLength = 190;
const maxTitleLength = 300;
/** The most characters of the heading context that starts every chunk. */
const maxContextLength = 300;
/** About how many characters of a section's previous chunk start its next one. */
const chunkOverlap = 150;

/** The source ID of a document slug, or `null` when the slug is not lower-case words and hyphens. */
export function documentSourceId(slug: string): string | null {
  return slug.length <= maxSlugLength && slugPattern.test(slug) ? `document:${slug}` : null;
}

const types: Readonly<
  Record<string, { readonly extension: DocumentExtension; readonly mediaType: DocumentMediaType }>
> = {
  md: { extension: "md", mediaType: "text/markdown" },
  markdown: { extension: "md", mediaType: "text/markdown" },
  txt: { extension: "txt", mediaType: "text/plain" },
};

/** The extension and media type a file name stands for, or `null` when it is not supported. */
export function documentTypeOf(
  fileName: string,
): { readonly extension: DocumentExtension; readonly mediaType: DocumentMediaType } | null {
  const name = fileName.split(/[/\\]/u).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return types[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** SHA-256 of the bytes, hex. */
export function contentHashOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const pdfMessage =
  "PDF documents are not supported yet; convert the document to Markdown or plain text and ingest that.";

/**
 * Prepares a document. Throws `DocumentRejectedError` for an invalid slug or title, an unsupported
 * type, bytes that are not UTF-8 text, an empty text and every exceeded limit. Sensitive values do
 * not throw: they are returned as findings, without the values.
 */
export function prepareDocument(
  input: DocumentInput,
  options: PrepareOptions = {},
): PreparedDocument {
  const limits = options.limits ?? defaultDocumentLimits;
  const clock = options.clock ?? (() => performance.now());
  const started = clock();
  const checkTime = () => {
    if (clock() - started > limits.maxProcessingMs) {
      reject(
        "too_slow",
        `Preparing the document took longer than ${String(limits.maxProcessingMs)} ms; split it into smaller documents.`,
      );
    }
  };

  const sourceId = documentSourceId(input.slug);
  if (sourceId === null) {
    reject(
      "invalid_slug",
      `The slug must be lower-case letters and digits in words joined by hyphens, at most ${String(maxSlugLength)} characters.`,
    );
  }
  const title = checkedTitle(input.title);
  if (input.bytes.length > limits.maxBytes) {
    reject(
      "too_large",
      `The file is larger than ${String(limits.maxBytes)} bytes; split it into smaller documents.`,
    );
  }
  const type = documentTypeOf(input.fileName);
  if (type === null) {
    if (/\.pdf$/iu.test(input.fileName)) reject("unsupported_type", pdfMessage);
    reject(
      "unsupported_type",
      "Only Markdown (.md, .markdown) and plain-text (.txt) documents are supported; convert the document first.",
    );
  }
  sniff(input.bytes);

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
  } catch {
    reject("not_utf8", "The file is not valid UTF-8 text; save it as UTF-8 and ingest it again.");
  }
  if (hasBinaryControl(decoded)) {
    reject(
      "unsupported_type",
      "The file holds binary data, not text; only Markdown and plain-text documents are supported.",
    );
  }
  checkTime();

  const text = clean(decoded);
  if (text.length > limits.maxExtractedChars) {
    reject(
      "extracted_too_large",
      `The cleaned text is longer than ${String(limits.maxExtractedChars)} characters; split it into smaller documents.`,
    );
  }
  checkTime();

  const findings = [...detect(title).map(({ kind }) => ({ kind, line: 0 })), ...detect(text)];
  checkTime();

  const sections =
    type.extension === "md" ? markdownSections(text, title) : textSections(text, title);
  if (sections.length === 0) {
    reject(
      "empty",
      "The document has no text below its headings; add the text and ingest it again.",
    );
  }
  const chunks = chunksOf(sections);
  checkTime();

  return {
    sourceId,
    title,
    mediaType: type.mediaType,
    extension: type.extension,
    contentHash: contentHashOf(input.bytes),
    text,
    sections: sections.map(({ ordinal, headingPath, start, end }) => ({
      ordinal,
      headingPath,
      start,
      end,
    })),
    chunks,
    findings: sortedFindings(findings),
  };
}

/** C0 controls other than tab, line feed, form feed and carriage return; DEL and C1 controls. */
function hasBinaryControl(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if ((code < 0x20 && ![0x09, 0x0a, 0x0c, 0x0d].includes(code)) || (code >= 0x7f && code <= 0x9f))
      return true;
  }
  return false;
}

function reject(reason: DocumentRejection, message: string): never {
  throw new DocumentRejectedError(reason, message);
}

function checkedTitle(value: string): string {
  const title = value.normalize("NFKC").trim();
  if (
    title.length === 0 ||
    title.length > maxTitleLength ||
    /[\p{Cc}]/u.test(title) ||
    title.includes("://")
  ) {
    reject(
      "invalid_title",
      `The display title must be one line of 1 to ${String(maxTitleLength)} characters and not an address.`,
    );
  }
  return title;
}

const startsWith = (bytes: Uint8Array, magic: readonly number[]) =>
  magic.every((byte, index) => bytes[index] === byte);

/** Refuses files whose first bytes name a binary format, whatever their file name says. */
function sniff(bytes: Uint8Array): void {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) reject("unsupported_type", pdfMessage);
  const binary = [
    [0x89, 0x50, 0x4e, 0x47],
    [0xc2, 0x89, 0x50, 0x4e, 0x47],
    [0x50, 0x4b, 0x03, 0x04],
  ];
  if (binary.some((magic) => startsWith(bytes, magic))) {
    reject(
      "unsupported_type",
      "The file is an image or an archive, not text; only Markdown and plain-text documents are supported.",
    );
  }
}

/**
 * Unicode NFKC, no byte-order mark, zero-width characters or soft hyphens, LF line breaks, single
 * spaces, trimmed lines, words hyphenated across a line break joined and at most one blank line.
 */
function clean(text: string): string {
  return text
    .replace(/^\uFEFF/u, "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/gu, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/\f/gu, "\n")
    .replace(/[\t\u00A0 ]+/gu, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

interface DraftSection extends SourceSection {
  readonly body: string;
}

const headingPattern = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/u;
const fencePattern = /^(```|~~~)/u;

/** Sections by ATX headings outside code fences; a heading without text below it is skipped. */
function markdownSections(text: string, title: string): DraftSection[] {
  const sections: DraftSection[] = [];
  const stack: { level: number; heading: string }[] = [];
  let path: readonly string[] = [title];
  let start = 0;
  let fence: string | null = null;
  let offset = 0;

  const close = (end: number) => {
    const body = text.slice(start, end).trim();
    if (body !== "") {
      sections.push({ ordinal: sections.length, headingPath: path, start, end, body });
    }
  };

  for (const line of text.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1;
    const opener = fencePattern.exec(line)?.[1];
    if (opener !== undefined) {
      if (fence === null) fence = opener;
      else if (opener === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const match = headingPattern.exec(line);
    if (match === null) continue;
    close(lineStart);
    const level = match[1]?.length ?? 1;
    const heading = (match[2] ?? "").trim();
    while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= level) stack.pop();
    if (!(level === 1 && stack.length === 0 && heading === title)) stack.push({ level, heading });
    path = [title, ...stack.map((entry) => entry.heading)];
    start = Math.min(offset, text.length);
  }
  close(text.length);
  return sections;
}

/** Plain text is one section below the title. */
function textSections(text: string, title: string): DraftSection[] {
  return text === ""
    ? []
    : [{ ordinal: 0, headingPath: [title], start: 0, end: text.length, body: text }];
}

/** Each section's body in pieces under the chunk limit, each led by its heading path. */
function chunksOf(sections: readonly DraftSection[]): SourceChunk[] {
  const chunks: SourceChunk[] = [];
  for (const section of sections) {
    const context = `${section.headingPath.join(" / ").slice(0, maxContextLength - 1)}\n`;
    for (const piece of overlapping(section.body, chunkMaxLength - context.length)) {
      const chunkText = `${context}${piece}`;
      chunks.push({
        sectionOrdinal: section.ordinal,
        ordinal: chunks.length,
        text: chunkText,
        textHash: sha256(chunkText),
      });
    }
  }
  return chunks;
}

/**
 * Splits text into word-aligned pieces of at most `max` characters; each piece after the first
 * starts with about `chunkOverlap` characters of the end of the previous one. A word longer than a
 * piece can hold is cut.
 */
function overlapping(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const longest = Math.max(1, max - chunkOverlap);
  const tokens: string[] = [];
  for (const token of text.match(/\S+\s*/gu) ?? []) {
    for (let index = 0; index < token.length; index += longest) {
      tokens.push(token.slice(index, index + longest));
    }
  }
  const pieces: string[] = [];
  let index = 0;
  let current: string[] = [];
  while (index < tokens.length) {
    let length = current.join("").trimEnd().length;
    let added = 0;
    while (index < tokens.length) {
      const token = tokens[index] ?? "";
      const next =
        length === 0 ? token.trimEnd().length : current.join("").length + token.trimEnd().length;
      if (added > 0 && next > max) break;
      if (added === 0 && next > max) current = [];
      current.push(token);
      length = current.join("").trimEnd().length;
      added += 1;
      index += 1;
    }
    pieces.push(current.join("").trim());
    const tail: string[] = [];
    let tailLength = 0;
    for (let back = current.length - 1; back > 0; back -= 1) {
      const token = current[back] ?? "";
      if (tailLength + token.length > chunkOverlap) break;
      tail.unshift(token);
      tailLength += token.length;
    }
    current = tail;
  }
  return pieces;
}

interface Detector {
  readonly kind: SensitivityKind;
  readonly pattern: RegExp;
  /** Whether a match is a sensitive value; every match is when absent. */
  readonly accept?: (match: RegExpExecArray) => boolean;
}

const credentialValue = (value: string) =>
  value.length >= 8 &&
  (/\d/u.test(value) ||
    (/[a-z]/u.test(value) && /[A-Z]/u.test(value)) ||
    (/\p{L}/u.test(value) && /[^\p{L}\p{N}]/u.test(value)));

const detectors: readonly Detector[] = [
  {
    kind: "private_key",
    pattern:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/gu,
  },
  {
    kind: "connection_string",
    pattern:
      /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver|jdbc:[a-z]+):\/\/\S+/giu,
  },
  { kind: "connection_string", pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@\S+/giu },
  {
    kind: "connection_string",
    pattern: /\b(?:Server|Data Source|Host)=[^;\n]+;[^\n]*?\b(?:Password|Pwd)=[^;\n]+/giu,
  },
  { kind: "credential", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu },
  { kind: "credential", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/gu },
  { kind: "credential", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/gu },
  { kind: "credential", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/gu },
  { kind: "credential", pattern: /\b[rsp]k_(?:live|test)_[A-Za-z0-9]{16,}/gu },
  { kind: "credential", pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/gu },
  { kind: "credential", pattern: /\bAIza[0-9A-Za-z_-]{30,}/gu },
  { kind: "credential", pattern: /\bpa-[A-Za-z0-9_-]{30,}/gu },
  {
    kind: "credential",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu,
  },
  { kind: "credential", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/giu },
  {
    kind: "credential",
    pattern:
      /\b(?:api[_-]?key|apikey|secret(?:[_-]?key)?|access[_-]?(?:key|token)|auth[_-]?token|token|client[_-]?secret|password|passwd|pwd)\s*[:=]\s*["']?([^\s"',;]+)/giu,
    accept: (match) => credentialValue(match[1] ?? ""),
  },
  {
    kind: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/gu,
  },
  {
    kind: "national_identifier",
    pattern: /\b(\d{2})(\d{2})(\d{2})(\/?)(\d{3,4})\b/gu,
    accept: (match) => czechBirthNumber(match),
  },
  {
    kind: "national_identifier",
    pattern: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/gu,
  },
  {
    kind: "bank_account",
    pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/gu,
    accept: (match) => ibanValid(match[0].replaceAll(" ", "")),
  },
  {
    kind: "bank_account",
    pattern: /\b(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})\b/gu,
    accept: (match) => czechAccountValid(match[1] ?? "", match[2] ?? ""),
  },
  { kind: "telephone", pattern: /(?:\+|\b00)[1-9]\d{0,2}(?:[ .-]?\d{2,4}){2,5}\b/gu },
  { kind: "telephone", pattern: /\(\d{3}\) ?\d{3}[ .-]\d{4}\b/gu },
  { kind: "telephone", pattern: /\b\d{3}[ .-]\d{3}[ .-]\d{3,4}\b/gu },
];

/**
 * Every sensitive value of a text as its kind and line, never the value. Each detector masks what
 * it found, so a value is reported once, under the most specific kind.
 */
function detect(text: string): SensitivityFinding[] {
  let masked = text;
  const findings: SensitivityFinding[] = [];
  for (const detector of detectors) {
    const pattern = new RegExp(detector.pattern.source, detector.pattern.flags);
    let next = masked;
    for (let match = pattern.exec(masked); match !== null; match = pattern.exec(masked)) {
      if (match[0] === "") {
        pattern.lastIndex += 1;
        continue;
      }
      if (detector.accept !== undefined && !detector.accept(match)) continue;
      findings.push({ kind: detector.kind, line: lineOf(masked, match.index) });
      next =
        next.slice(0, match.index) +
        match[0].replace(/[^\n]/gu, " ") +
        next.slice(match.index + match[0].length);
    }
    masked = next;
  }
  return findings;
}

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

function sortedFindings(findings: readonly SensitivityFinding[]): SensitivityFinding[] {
  const unique = new Map<string, SensitivityFinding>();
  for (const finding of findings) unique.set(`${finding.kind}:${String(finding.line)}`, finding);
  return [...unique.values()].sort(
    (left, right) =>
      left.line - right.line ||
      sensitivityKinds.indexOf(left.kind) - sensitivityKinds.indexOf(right.kind),
  );
}

/** A Czech or Slovak birth number: a valid month and day and, with ten digits, divisible by 11. */
function czechBirthNumber(match: RegExpExecArray): boolean {
  const [, year = "", month = "", day = "", slash = "", serial = ""] = match;
  let monthNumber = Number(month);
  if (monthNumber > 70) monthNumber -= 70;
  else if (monthNumber > 50) monthNumber -= 50;
  else if (monthNumber > 20) monthNumber -= 20;
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return false;
  if (serial.length === 3) return slash === "/" && Number(year) < 54;
  const digits = `${year}${month}${day}${serial}`;
  const head = Number(digits.slice(0, 9)) % 11;
  return Number(digits) % 11 === 0 || (head === 10 && digits.endsWith("0"));
}

function ibanValid(iban: string): boolean {
  if (iban.length < 15 || iban.length > 34) return false;
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const character of rearranged) {
    const value = /\d/u.test(character) ? character : String(character.charCodeAt(0) - 55);
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

const weighted = (digits: string, weights: readonly number[]) =>
  Array.from(digits.padStart(weights.length, "0"), Number).reduce(
    (sum, digit, index) => sum + digit * (weights[index] ?? 0),
    0,
  ) %
    11 ===
  0;

/** A Czech account number: an optional prefix and a number of 6 to 10 digits, both mod 11. */
function czechAccountValid(prefix: string, number: string): boolean {
  if (number.length < 6 || /^0+$/u.test(number)) return false;
  return weighted(prefix, [10, 5, 8, 4, 2, 1]) && weighted(number, [6, 3, 7, 9, 10, 5, 8, 4, 2, 1]);
}
