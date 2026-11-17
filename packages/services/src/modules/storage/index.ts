import { resolve } from "node:path";

import { createBunnyS3Driver, createBunnyS3NamespaceStore } from "./drivers/bunny-s3.js";
import { createLocalDriver, createLocalNamespaceStore } from "./drivers/local.js";
import { addressOf, prefixOf, segmentPattern, type StoredExtension } from "./keys.js";
import { ownedNamespace } from "./namespace.js";

export type { StoredExtension } from "./keys.js";

/** The key prefix and public base every driver shares. */
interface StorageLayout {
  /** The environment folder, the first segment of every key. */
  readonly environment: string;
  /** The worktree folder below the environment, or `null` outside a development worktree. */
  readonly worktree: string | null;
  /** The address files are publicly served from, without a trailing slash. */
  readonly publicBaseUrl: string;
}

/** Files on local disk, served by the API. */
export interface LocalStorageConfig extends StorageLayout {
  readonly driver: "local";
  /** Absolute folder that holds every local file. */
  readonly root: string;
}

/** Bunny Storage through its S3-compatible API; files are served by the zone's CDN pull zone. */
export interface BunnyS3StorageConfig extends StorageLayout {
  readonly driver: "bunny-s3";
  /** The S3 endpoint of the zone's region, an https origin without a path. */
  readonly endpoint: string;
  /** The region code the requests are signed for, for example `de`. */
  readonly region: string;
  /** The storage zone: the bucket and the access key id. */
  readonly zone: string;
  /** The zone password, the secret access key. Never logged or put into an error. */
  readonly password: string;
}

/** The validated storage settings of a process. Read once where it starts, then passed down. */
export type StorageConfig = LocalStorageConfig | BunnyS3StorageConfig;

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

/** A Bunny S3 region code, such as `de` or `syd`. */
const regionPattern = /^[a-z][a-z0-9-]{0,31}$/;
/** A zone password: printable, without whitespace. */
const passwordPattern = /^[\x21-\x7e]{1,256}$/;

/**
 * Reads the storage settings from an environment such as `process.env`. Throws an error naming
 * every missing or invalid variable, never their values; there are no fallbacks, so a cloud
 * selection never writes to local disk.
 *
 * - `local`: `STORAGE_LOCAL_ROOT`, resolved against `cwd` when relative.
 * - `bunny-s3`: `STORAGE_BUNNY_ENDPOINT` (a bare https origin), `STORAGE_BUNNY_REGION`,
 *   `STORAGE_BUNNY_ZONE` and `STORAGE_BUNNY_PASSWORD`. `STORAGE_PUBLIC_BASE_URL` must be https and
 *   must not address the storage endpoint, and `STORAGE_WORKTREE` is required in `development`,
 *   where every worktree shares the development zone.
 */
export function readStorageConfig(env: Environment, cwd: string = process.cwd()): StorageConfig {
  const driver = env["STORAGE_DRIVER"];
  const invalid: string[] = [];
  if (driver !== "local" && driver !== "bunny-s3") invalid.push("STORAGE_DRIVER");

  const environment = env["STORAGE_ENVIRONMENT"] ?? "";
  if (!segmentPattern.test(environment)) invalid.push("STORAGE_ENVIRONMENT");

  const worktree = env["STORAGE_WORKTREE"] ?? "";
  const worktreeRequired = driver === "bunny-s3" && environment === "development";
  if (worktree === "" ? worktreeRequired : !segmentPattern.test(worktree)) {
    invalid.push("STORAGE_WORKTREE");
  }

  const layout = { environment, worktree: worktree === "" ? null : worktree };
  const fail = (): never => {
    throw new Error(
      `Invalid storage configuration: set ${invalid.join(", ")} (documented in .env.example)`,
    );
  };

  if (driver === "bunny-s3") {
    const endpoint = httpsOrigin(env["STORAGE_BUNNY_ENDPOINT"]);
    if (endpoint === null) invalid.push("STORAGE_BUNNY_ENDPOINT");
    const region = env["STORAGE_BUNNY_REGION"] ?? "";
    if (!regionPattern.test(region)) invalid.push("STORAGE_BUNNY_REGION");
    const zone = env["STORAGE_BUNNY_ZONE"] ?? "";
    if (!segmentPattern.test(zone)) invalid.push("STORAGE_BUNNY_ZONE");
    const password = env["STORAGE_BUNNY_PASSWORD"] ?? "";
    if (!passwordPattern.test(password)) invalid.push("STORAGE_BUNNY_PASSWORD");
    const base = publicBase(env["STORAGE_PUBLIC_BASE_URL"], ["https:"]);
    if (base === null || (endpoint !== null && addressesHost(base, endpoint))) {
      invalid.push("STORAGE_PUBLIC_BASE_URL");
    }
    if (invalid.length > 0 || endpoint === null || base === null) return fail();
    return { driver, endpoint, region, zone, password, ...layout, publicBaseUrl: base };
  }

  const root = env["STORAGE_LOCAL_ROOT"] ?? "";
  if (root.length === 0 || root.includes("\0")) invalid.push("STORAGE_LOCAL_ROOT");
  const base = publicBase(env["STORAGE_PUBLIC_BASE_URL"], ["http:", "https:"]);
  if (base === null) invalid.push("STORAGE_PUBLIC_BASE_URL");
  if (invalid.length > 0 || base === null) return fail();
  return { driver: "local", root: resolve(cwd, root), ...layout, publicBaseUrl: base };
}

/** An address without credentials, query, fragment or trailing slash, or `null`. */
function publicBase(value: string | undefined, protocols: readonly string[]): string | null {
  if (value === undefined || !URL.canParse(value)) return null;
  const url = new URL(value);
  if (!protocols.includes(url.protocol) || url.username || url.password) return null;
  if (url.search || url.hash) return null;
  return url.href.replace(/\/+$/, "");
}

/** The origin of an https address that is nothing but an origin, or `null`. */
function httpsOrigin(value: string | undefined): string | null {
  if (value === undefined || !URL.canParse(value)) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.pathname !== "/" || url.search || url.hash || value.includes("?")) return null;
  return url.origin;
}

/** Whether the address is on the host of the origin or on one of its subdomains (a bucket host). */
function addressesHost(address: string, origin: string): boolean {
  const host = new URL(origin).hostname;
  const target = new URL(address).hostname;
  return target === host || target.endsWith(`.${host}`);
}

/** Opens the configured driver. Nothing touches the disk until the first operation. */
export function openStorage(config: StorageConfig): OpenedStorage {
  if (config.driver === "bunny-s3") return { storage: createBunnyS3Driver(config), files: null };
  const prefix = prefixOf(config);
  const local = createLocalDriver(config.root, prefix);
  return {
    storage: {
      store: (file) => local.store(file),
      delete: (key) => local.delete(key),
      publicAddress: (key) => addressOf(prefix, config.publicBaseUrl, key),
    },
    files: { read: (key) => local.read(key) },
  };
}

/**
 * The storage folder of one development worktree, `<environment>/<worktree>/`, claimed by an owner
 * marker so only the worktree that prepared it can remove it. Every operation refuses, without
 * touching storage, a configuration without a worktree folder, the production environment and an
 * invalid owner name.
 */
export interface StorageNamespace {
  /** Creates the folder and its marker, or reuses the folder this owner already holds. */
  prepare(): Promise<"created" | "reused">;
  /** Removes every file of the folder this owner holds; a folder that does not exist is absent. */
  remove(): Promise<"removed" | "absent">;
}

/**
 * Opens the namespace of the configured worktree for `owner`, the worktree's name. Refuses a folder
 * another owner's marker claims and files without a marker, and on local disk a prefix folder or
 * marker that is a symbolic link. Nothing is touched until the first operation.
 */
export function openStorageNamespace(config: StorageConfig, owner: string): StorageNamespace {
  const store =
    config.driver === "bunny-s3"
      ? createBunnyS3NamespaceStore(config)
      : createLocalNamespaceStore(config.root, prefixOf(config));
  return ownedNamespace(config, owner, store);
}
