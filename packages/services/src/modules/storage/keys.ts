import { randomUUID } from "node:crypto";

/** The file extensions storage accepts, one per stored media type. */
export const storedExtensions = ["png", "jpg", "webp", "pdf"] as const;

export type StoredExtension = (typeof storedExtensions)[number];

/** A folder name: lower-case letters, digits and hyphens, starting with a letter or digit. */
export const segmentPattern = /^[a-z0-9][a-z0-9-]{0,62}$/;

const filePattern = new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(${storedExtensions.join("|")})$`,
);

/** The folders every key of one storage starts with: the environment, then the worktree. */
export type KeyPrefix = readonly string[];

export function isStoredExtension(value: string): value is StoredExtension {
  return (storedExtensions as readonly string[]).includes(value);
}

/** A new key under the prefix: a random UUID with the extension. Never chosen by a caller. */
export function newKey(prefix: KeyPrefix, extension: StoredExtension): string {
  if (!isStoredExtension(extension)) throw new Error("The extension is not an accepted one.");
  return [...prefix, `${randomUUID()}.${extension}`].join("/");
}

/**
 * The file name of a key that this storage could have generated, or `null`: exactly the prefix
 * folders followed by a generated name. Anything else, including traversal, another environment or
 * worktree and absolute paths, is not a key of this storage.
 */
export function fileNameOf(prefix: KeyPrefix, key: string): string | null {
  const segments = key.split("/");
  if (segments.length !== prefix.length + 1) return null;
  if (!prefix.every((folder, index) => segments[index] === folder)) return null;
  const name = segments.at(-1) ?? "";
  return filePattern.test(name) ? name : null;
}
