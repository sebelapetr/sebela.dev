import { resolve } from "node:path";

import { createLocalDriver } from "./drivers/local.js";
import { fileNameOf, segmentPattern, type StoredExtension } from "./keys.js";

export type { StoredExtension } from "./keys.js";

/** The validated storage settings of a process. Read once where it starts, then passed down. */
export interface StorageConfig {
  readonly driver: "local";
  /** Absolute folder that holds every local file. */
  readonly root: string;
  /** The environment folder, the first segment of every key. */
  readonly environment: string;
  /** The worktree folder below the environment, or `null` outside a development worktree. */
  readonly worktree: string | null;
  /** The address files are publicly served from, without a trailing slash. */
  readonly publicBaseUrl: string;
}

/**
 * Store a file, delete it, give its public address. Keys are `<environment>/[<worktree>/]<uuid>.<ext>`,
 * generated here and never chosen by a caller; a key outside this storage's prefix is refused.
 */
export interface Storage {
  /** Writes a new file and returns its key. Never replaces an existing file. */
  store(file: { bytes: Uint8Array; extension: StoredExtension }): Promise<string>;
  /** Removes the file; a file that is already gone counts as removed. */
  delete(key: string): Promise<void>;
  /**
   * The public address of the key, computed from the configured base; nothing is stored.
   * `null` when this storage cannot address the key, for example a key written under
   * another environment or worktree prefix.
   */
  publicAddress(key: string): string | null;
}

/** Reads the files a driver keeps on local disk, so the API can serve them. */
export interface LocalFiles {
  /** The bytes of a stored file, or `null` for a missing file or a key outside this storage. */
  read(key: string): Promise<Uint8Array | null>;
}

export interface OpenedStorage {
  readonly storage: Storage;
  /** Set for a driver whose files the API serves itself; `null` when they are served elsewhere. */
  readonly files: LocalFiles | null;
}

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Reads the storage settings from an environment such as `process.env`. A relative
 * `STORAGE_LOCAL_ROOT` is resolved against `cwd`. Throws an error naming every missing or invalid
 * variable, never their values; there are no fallbacks. `bunny-s3` is refused until its driver
 * exists, so a cloud selection never writes to local disk.
 */
export function readStorageConfig(env: Environment, cwd: string = process.cwd()): StorageConfig {
  const driver = env["STORAGE_DRIVER"];
  if (driver === "bunny-s3") {
    throw new Error(
      "Invalid storage configuration: STORAGE_DRIVER=bunny-s3 is not available yet (#36); use local.",
    );
  }
  const invalid: string[] = [];
  if (driver !== "local") invalid.push("STORAGE_DRIVER");

  const root = env["STORAGE_LOCAL_ROOT"] ?? "";
  if (root.length === 0 || root.includes("\0")) invalid.push("STORAGE_LOCAL_ROOT");

  const environment = env["STORAGE_ENVIRONMENT"] ?? "";
  if (!segmentPattern.test(environment)) invalid.push("STORAGE_ENVIRONMENT");

  const worktree = env["STORAGE_WORKTREE"] ?? "";
  if (worktree !== "" && !segmentPattern.test(worktree)) invalid.push("STORAGE_WORKTREE");

  const base = publicBase(env["STORAGE_PUBLIC_BASE_URL"]);
  if (base === null) invalid.push("STORAGE_PUBLIC_BASE_URL");

  if (invalid.length > 0 || base === null) {
    throw new Error(
      `Invalid storage configuration: set ${invalid.join(", ")} (documented in .env.example)`,
    );
  }
  return {
    driver: "local",
    root: resolve(cwd, root),
    environment,
    worktree: worktree === "" ? null : worktree,
    publicBaseUrl: base,
  };
}

/** An http(s) address without query, fragment or trailing slash, or `null`. */
function publicBase(value: string | undefined): string | null {
  if (value === undefined || !URL.canParse(value)) return null;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.search || url.hash) return null;
  return url.href.replace(/\/+$/, "");
}

/** Opens the configured driver. Nothing touches the disk until the first operation. */
export function openStorage(config: StorageConfig): OpenedStorage {
  const prefix =
    config.worktree === null ? [config.environment] : [config.environment, config.worktree];
  const local = createLocalDriver(config.root, prefix);
  return {
    storage: {
      store: (file) => local.store(file),
      delete: (key) => local.delete(key),
      publicAddress(key) {
        return fileNameOf(prefix, key) === null ? null : `${config.publicBaseUrl}/${key}`;
      },
    },
    files: { read: (key) => local.read(key) },
  };
}
