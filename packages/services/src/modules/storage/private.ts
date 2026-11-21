import { isAbsolute, relative, resolve } from "node:path";

import { createBunnyS3PrivateDriver } from "./drivers/bunny-s3.js";
import { createLocalDriver } from "./drivers/local.js";
import { prefixOf, privateExtensions, segmentPattern, type PrivateExtension } from "./keys.js";
import { httpsOrigin, passwordPattern, regionPattern } from "./settings.js";

/** The key prefix of a private storage: the same environment and worktree folders as media. */
interface PrivateLayout {
  /** The environment folder, the first segment of every key. */
  readonly environment: string;
  /** The worktree folder below the environment, or `null` outside a development worktree. */
  readonly worktree: string | null;
}

/** Private files on local disk, below a root apart from the public media root. */
export interface LocalPrivateStorageConfig extends PrivateLayout {
  readonly driver: "local";
  /** Absolute folder that holds every private file; never inside or around the media root. */
  readonly root: string;
}

/** A private Bunny Storage zone with its own credentials and no CDN pull zone. */
export interface BunnyS3PrivateStorageConfig extends PrivateLayout {
  readonly driver: "bunny-s3";
  /** The S3 endpoint of the zone's region, an https origin without a path. */
  readonly endpoint: string;
  /** The region code the requests are signed for, for example `de`. */
  readonly region: string;
  /** The private storage zone: the bucket and the access key id; never the media zone. */
  readonly zone: string;
  /** The zone password, the secret access key. Never logged or put into an error. */
  readonly password: string;
}

/** The validated private storage settings of a process. */
export type PrivateStorageConfig = LocalPrivateStorageConfig | BunnyS3PrivateStorageConfig;

/**
 * Store, read and delete private originals. There is no address of any kind: nothing in it is
 * served by the API, the media route or a CDN. Keys are `<environment>/[<worktree>/]<uuid>.<ext>`,
 * generated here; a key outside the prefix is never read and refused on delete.
 */
export interface PrivateStorage {
  /** Writes a new file and returns its key. Never replaces an existing file. */
  store(file: { bytes: Uint8Array; extension: PrivateExtension }): Promise<string>;
  /** The bytes of a stored file, or `null` for a missing file or a key outside this storage. */
  read(key: string): Promise<Uint8Array | null>;
  /** Removes the file; a file that is already gone counts as removed. */
  delete(key: string): Promise<void>;
}

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Reads the private storage settings from an environment such as `process.env`. Throws an error
 * naming every missing or invalid variable, never their values; there are no fallbacks, so a
 * `bunny-s3` selection never writes to local disk.
 *
 * - `PRIVATE_STORAGE_DRIVER`: `local` or `bunny-s3`, always explicit.
 * - `local`: `PRIVATE_STORAGE_LOCAL_ROOT`, resolved against `cwd` when relative; it must not be,
 *   lie inside or contain the media root `STORAGE_LOCAL_ROOT` when that is set.
 * - `bunny-s3`: `PRIVATE_STORAGE_BUNNY_ENDPOINT` (a bare https origin), `…_REGION`, `…_ZONE` (not
 *   the media zone `STORAGE_BUNNY_ZONE`) and `…_PASSWORD`.
 * - The key prefix is the media one: `STORAGE_ENVIRONMENT` and `STORAGE_WORKTREE`, which
 *   `bunny-s3` requires in `development`.
 */
export function readPrivateStorageConfig(
  env: Environment,
  cwd: string = process.cwd(),
): PrivateStorageConfig {
  const driver = env["PRIVATE_STORAGE_DRIVER"];
  const invalid: string[] = [];
  if (driver !== "local" && driver !== "bunny-s3") invalid.push("PRIVATE_STORAGE_DRIVER");

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
      `Invalid private storage configuration: set ${invalid.join(", ")} (documented in .env.example)`,
    );
  };

  if (driver === "bunny-s3") {
    const endpoint = httpsOrigin(env["PRIVATE_STORAGE_BUNNY_ENDPOINT"]);
    if (endpoint === null) invalid.push("PRIVATE_STORAGE_BUNNY_ENDPOINT");
    const region = env["PRIVATE_STORAGE_BUNNY_REGION"] ?? "";
    if (!regionPattern.test(region)) invalid.push("PRIVATE_STORAGE_BUNNY_REGION");
    const zone = env["PRIVATE_STORAGE_BUNNY_ZONE"] ?? "";
    if (!segmentPattern.test(zone) || zone === env["STORAGE_BUNNY_ZONE"]) {
      invalid.push("PRIVATE_STORAGE_BUNNY_ZONE");
    }
    const password = env["PRIVATE_STORAGE_BUNNY_PASSWORD"] ?? "";
    if (!passwordPattern.test(password)) invalid.push("PRIVATE_STORAGE_BUNNY_PASSWORD");
    if (invalid.length > 0 || endpoint === null) return fail();
    return { driver, endpoint, region, zone, password, ...layout };
  }

  const value = env["PRIVATE_STORAGE_LOCAL_ROOT"] ?? "";
  const root = value.length === 0 || value.includes("\0") ? null : resolve(cwd, value);
  const media = env["STORAGE_LOCAL_ROOT"];
  if (
    root === null ||
    (media !== undefined && media !== "" && overlaps(root, resolve(cwd, media)))
  ) {
    invalid.push("PRIVATE_STORAGE_LOCAL_ROOT");
  }
  if (invalid.length > 0 || root === null) return fail();
  return { driver: "local", root, ...layout };
}

/** Whether one folder is the other or lies inside it. */
function overlaps(first: string, second: string): boolean {
  const inside = (folder: string, parent: string) => {
    const path = relative(parent, folder);
    return path === "" || (!path.startsWith("..") && !isAbsolute(path));
  };
  return inside(first, second) || inside(second, first);
}

/** Opens the configured private driver. Nothing is touched until the first operation. */
export function openPrivateStorage(config: PrivateStorageConfig): PrivateStorage {
  if (config.driver === "bunny-s3") return createBunnyS3PrivateDriver(config);
  const local = createLocalDriver(config.root, prefixOf(config), privateExtensions);
  return {
    store: (file) => local.store(file),
    read: (key) => local.read(key),
    delete: (key) => local.delete(key),
  };
}
