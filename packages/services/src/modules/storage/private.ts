import type { PrivateExtension } from "./keys.js";

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
 * naming every missing or invalid variable, never their values; there are no fallbacks.
 */
export const readPrivateStorageConfig: (
  env: Environment,
  cwd?: string,
) => PrivateStorageConfig = () => {
  throw new Error("not implemented");
};

/** Opens the configured private driver. Nothing is touched until the first operation. */
export const openPrivateStorage: (config: PrivateStorageConfig) => PrivateStorage = () => {
  throw new Error("not implemented");
};
