/** The file extensions storage accepts, one per stored media type. */
export type StoredExtension = "png" | "jpg" | "webp" | "pdf";

/** The validated storage settings of a process. */
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

/** Store a file, delete it, give its public address. Keys are generated here, never by callers. */
export interface Storage {
  store(file: { bytes: Uint8Array; extension: StoredExtension }): Promise<string>;
  delete(key: string): Promise<void>;
  publicAddress(key: string): string;
}

/** Reads the files a driver keeps on local disk, so the API can serve them. */
export interface LocalFiles {
  read(key: string): Promise<Uint8Array | null>;
}

export interface OpenedStorage {
  readonly storage: Storage;
  readonly files: LocalFiles | null;
}

export function readStorageConfig(
  _env: Readonly<Record<string, string | undefined>>,
  _cwd: string = process.cwd(),
): StorageConfig {
  throw new Error(`Not implemented yet: ${typeof _env}, ${typeof _cwd}.`);
}

export function openStorage(_config: StorageConfig): OpenedStorage {
  throw new Error(`Not implemented yet: ${typeof _config}.`);
}
