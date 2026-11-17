import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import type { HttpRequest } from "@smithy/types";

import type { BunnyS3StorageConfig, Storage } from "../index.js";
import { addressOf, fileNameOf, newKey, prefixOf, type StoredExtension } from "../keys.js";
import { markerName, type NamespaceStore } from "../namespace.js";

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

/**
 * Sends one exchange. The driver-contract tests pass an in-memory endpoint here, so the real S3
 * client builds and signs every request without a network or credentials.
 */
export type S3Transport = (exchange: S3Exchange) => Promise<S3Reply>;

const contentTypes: Readonly<Record<StoredExtension, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
};

/**
 * Bunny Storage through its S3-compatible API (path-style, signed with the zone name and password
 * as the access key pair). Keys are generated inside the prefix before anything is sent, and a key
 * outside it is refused without a request, so the driver never reaches another environment or
 * worktree. Files are served by the zone's CDN pull zone from the configured public base.
 *
 * Bunny does not document conditional writes (`If-None-Match`) for PutObject, so a new file is not
 * guarded against replacement by the endpoint; keys carry 122 random bits instead. Every upload
 * carries its SHA-256 checksum, which the zone verifies. SDK errors never leave the driver: a
 * failure becomes a plain `Error` naming the operation, the HTTP status and the S3 error code.
 */
export function createBunnyS3Driver(
  config: BunnyS3StorageConfig,
  transport?: S3Transport,
): Storage {
  const prefix = prefixOf(config);
  const client = clientFor(config, transport);

  return {
    async store(file) {
      const key = newKey(prefix, file.extension);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.zone,
            Key: key,
            Body: file.bytes,
            ContentType: contentTypes[file.extension],
            ChecksumSHA256: createHash("sha256").update(file.bytes).digest("base64"),
          }),
        );
      } catch (error) {
        throw storageError("store the file", error);
      }
      return key;
    },

    async delete(key) {
      if (fileNameOf(prefix, key) === null)
        throw new Error("The key is not a key of this storage.");
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.zone, Key: key }));
      } catch (error) {
        // A missing key counts as removed; any other failure, another 404 included, does not.
        if (error instanceof S3ServiceException && error.name === "NoSuchKey") return;
        throw storageError("delete the file", error);
      }
    },

    publicAddress: (key) => addressOf(prefix, config.publicBaseUrl, key),
  };
}

/**
 * The owner-guarded namespace `<environment>/<worktree>/` in the zone: the marker is one object,
 * listing pages through ListObjectsV2 by the namespace's prefix (with its trailing slash, so a
 * sibling whose name starts the same is never included), and clearing deletes every listed key,
 * the marker last. Bunny has no conditional PutObject, so a marker written by two worktrees at once
 * is not detected; each worktree has its own folder name, so this does not happen in practice.
 */
export function createBunnyS3NamespaceStore(
  config: BunnyS3StorageConfig,
  transport?: S3Transport,
): NamespaceStore {
  const client = clientFor(config, transport);
  const folder = `${prefixOf(config).join("/")}/`;
  const marker = `${folder}${markerName}`;

  const list = async (): Promise<string[]> => {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      let page;
      try {
        page = await client.send(
          new ListObjectsV2Command({
            Bucket: config.zone,
            Prefix: folder,
            ContinuationToken: token,
          }),
        );
      } catch (error) {
        throw storageError("list the worktree folder", error);
      }
      for (const { Key } of page.Contents ?? []) {
        if (Key?.startsWith(folder) === true) keys.push(Key);
      }
      token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
    } while (token !== undefined);
    return keys;
  };

  const remove = async (key: string) => {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: config.zone, Key: key }));
    } catch (error) {
      if (error instanceof S3ServiceException && error.name === "NoSuchKey") return;
      throw storageError("delete a file of the worktree folder", error);
    }
  };

  return {
    async readMarker() {
      try {
        const reply = await client.send(new GetObjectCommand({ Bucket: config.zone, Key: marker }));
        return (await reply.Body?.transformToString("utf-8")) ?? "";
      } catch (error) {
        if (error instanceof S3ServiceException && error.name === "NoSuchKey") return null;
        throw storageError("read the worktree owner marker", error);
      }
    },

    async hasFiles() {
      return (await list()).some((key) => key !== marker);
    },

    async writeMarker(content) {
      const bytes = new TextEncoder().encode(content);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.zone,
            Key: marker,
            Body: bytes,
            ContentType: "text/plain; charset=utf-8",
            ChecksumSHA256: createHash("sha256").update(bytes).digest("base64"),
          }),
        );
      } catch (error) {
        throw storageError("write the worktree owner marker", error);
      }
    },

    async clear() {
      for (const key of await list()) if (key !== marker) await remove(key);
      await remove(marker);
    },
  };
}

/** One S3 client for the zone, path-style and signed with the zone name and password. */
function clientFor(config: BunnyS3StorageConfig, transport?: S3Transport): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.zone, secretAccessKey: config.password },
    forcePathStyle: true,
    // Bunny verifies SHA-256 only; the SDK's default CRC32 would be an unsupported header.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    ...(transport === undefined ? {} : { requestHandler: handlerFor(transport) }),
  });
}

/** A plain error for a failed request, without the SDK object, the request or any credential. */
function storageError(action: string, error: unknown): Error {
  if (!(error instanceof S3ServiceException)) {
    return new Error(`Bunny storage could not ${action}: the request failed.`);
  }
  const status = error.$metadata.httpStatusCode ?? "unknown";
  const code = /^[A-Za-z]{1,64}$/.test(error.name) ? `, ${error.name}` : "";
  return new Error(`Bunny storage could not ${action} (HTTP ${String(status)}${code}).`);
}

/** Adapts a transport to the S3 client's HTTP handler; only the driver sees the SDK's types. */
function handlerFor(transport: S3Transport): NonNullable<S3ClientConfig["requestHandler"]> {
  return {
    async handle(request: HttpRequest) {
      const reply = await transport({
        method: request.method,
        url: urlOf(request),
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), value]),
        ),
        body: bytesOf(request.body),
      });
      return {
        response: {
          statusCode: reply.status,
          headers: { ...reply.headers },
          // A stream, as from a real connection, so object bodies can be read as well.
          body: Readable.from([Buffer.from(reply.body ?? "", "utf8")]),
        },
      };
    },
    updateHttpClientConfig: () => undefined,
    httpHandlerConfigs: () => ({}),
  };
}

function urlOf(request: HttpRequest): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(request.query ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) query.append(name, item ?? "");
  }
  const port = request.port === undefined ? "" : `:${String(request.port)}`;
  const search = query.size === 0 ? "" : `?${query.toString()}`;
  return `${request.protocol}//${request.hostname}${port}${request.path}${search}`;
}

function bytesOf(body: unknown): Uint8Array {
  if (body === undefined || body === null) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (typeof body === "string") return new TextEncoder().encode(body);
  throw new Error("The S3 transport accepts only buffered request bodies.");
}
