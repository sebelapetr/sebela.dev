import type { BunnyS3StorageConfig, Storage } from "../index.js";

/** One signed HTTP request the S3 client would send to the storage endpoint. */
export interface S3Exchange {
  readonly method: string;
  /** The full address, with the path and any query. */
  readonly url: string;
  /** Header names in lower case. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

/** What the endpoint answered. */
export interface S3Reply {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** Sends one exchange. Replaces the network for the driver-contract tests. */
export type S3Transport = (exchange: S3Exchange) => Promise<S3Reply>;

export function createBunnyS3Driver(
  config: BunnyS3StorageConfig,
  transport?: S3Transport,
): Storage {
  throw new Error(
    `The bunny-s3 driver for ${config.zone} is not implemented yet (${transport === undefined ? "network" : "transport"}).`,
  );
}
