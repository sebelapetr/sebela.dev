import { randomUUID } from "node:crypto";

/** The file extensions storage accepts, one per stored media type. */
export const storedExtensions = ["png", "jpg", "webp", "pdf"] as const;

export type StoredExtension = (typeof storedExtensions)[number];

/** The file extensions private storage accepts: the knowledge document originals. */
export const privateExtensions = ["md", "txt"] as const;

export type PrivateExtension = (typeof privateExtensions)[number];

/** A folder name: lower-case letters, digits and hyphens, starting with a letter or digit. */
export const segmentPattern = /^[a-z0-9][a-z0-9-]{0,62}$/;

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

const namePatterns = new Map<readonly string[], RegExp>();

/** The generated file names with one of the extensions. */
function namePattern(extensions: readonly string[]): RegExp {
  let pattern = namePatterns.get(extensions);
  if (pattern === undefined) {
    pattern = new RegExp(`^${uuidPattern}\\.(${extensions.join("|")})$`);
    namePatterns.set(extensions, pattern);
  }
  return pattern;
}

/** The folders every key of one storage starts with: the environment, then the worktree. */
export type KeyPrefix = readonly string[];

/** The prefix of a configured storage: its environment, then its worktree when it has one. */
export function prefixOf(layout: {
  readonly environment: string;
  readonly worktree: string | null;
}): KeyPrefix {
  return layout.worktree === null ? [layout.environment] : [layout.environment, layout.worktree];
}

/** The public address of a key of this prefix below the base, or `null` for any other key. */
export function addressOf(prefix: KeyPrefix, base: string, key: string): string | null {
  return fileNameOf(prefix, key) === null ? null : `${base}/${key}`;
}

export function isStoredExtension(value: string): value is StoredExtension {
  return (storedExtensions as readonly string[]).includes(value);
}

/**
 * A new key under the prefix: a random UUID with the extension, which must be one of `extensions`.
 * Never chosen by a caller.
 */
export function newKey(
  prefix: KeyPrefix,
  extension: string,
  extensions: readonly string[] = storedExtensions,
): string {
  if (!extensions.includes(extension)) throw new Error("The extension is not an accepted one.");
  return [...prefix, `${randomUUID()}.${extension}`].join("/");
}

/**
 * The file name of a key that this storage could have generated, or `null`: exactly the prefix
 * folders followed by a generated name with one of `extensions`. Anything else, including
 * traversal, another environment or worktree and absolute paths, is not a key of this storage.
 */
export function fileNameOf(
  prefix: KeyPrefix,
  key: string,
  extensions: readonly string[] = storedExtensions,
): string | null {
  const segments = key.split("/");
  if (segments.length !== prefix.length + 1) return null;
  if (!prefix.every((folder, index) => segments[index] === folder)) return null;
  const name = segments.at(-1) ?? "";
  return namePattern(extensions).test(name) ? name : null;
}
