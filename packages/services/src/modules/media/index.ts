import type { Media, MediaType, MediaUpdate } from "@sebela/contracts";
import type { MediaPersistence, MediaRecord } from "@sebela/db";

import { DomainError } from "../../errors.js";
import { readStorageConfig, type OpenedStorage, type StorageConfig } from "../storage/index.js";
import { inspectUpload } from "./inspect.js";

/** The upload limits of a process. */
export interface MediaLimits {
  /** The largest accepted file, in bytes. */
  readonly maxBytes: number;
  /** The largest accepted image width and height, in pixels. */
  readonly maxImageDimension: number;
}

export interface MediaConfig {
  readonly storage: StorageConfig;
  readonly limits: MediaLimits;
}

/**
 * A stored file the media workflow could not remove; it is left behind without a record. Carries the
 * key and the error, never file contents or credentials.
 */
export interface CleanupFailure {
  /** `upload`: the metadata write failed after the file was stored. `delete`: the record is gone. */
  readonly operation: "upload" | "delete";
  readonly key: string;
  readonly error: unknown;
}

export interface MediaUploadInput {
  readonly bytes: Uint8Array;
  /** The original file name; only its extension is checked, it never chooses the destination. */
  readonly filename: string;
  /** The type the caller declared; must match the content unless empty or `application/octet-stream`. */
  readonly declaredType: string;
  readonly altText?: string | null | undefined;
}

/** Media `ensureMedia` reused or uploaded. */
export interface EnsuredMedia {
  readonly media: Media;
  /** `true` when the file was stored and recorded by this call. */
  readonly created: boolean;
}

/** A stored file with the type its content proved. */
export interface MediaFile {
  readonly bytes: Uint8Array;
  readonly mediaType: MediaType;
}

/**
 * Uploaded images and PDFs: their files in storage and their metadata in the database, kept
 * together. Refusals are `DomainError`s: `not_found`, `conflict` for deleting attached media,
 * `payload_too_large`, `unsupported_media_type` and `validation_failed` on `file`.
 */
export interface MediaService {
  /** Every media record, newest first. */
  listMedia(): Promise<Media[]>;
  getMedia(id: string): Promise<Media>;
  /**
   * Proves the type from the content, stores the file under a generated key, then records it. A
   * refused file stores nothing; a failed metadata write removes the stored file again.
   */
  uploadMedia(input: MediaUploadInput): Promise<Media>;
  /**
   * The oldest recorded media with exactly the content of `input`, or else a new upload of it;
   * `created` tells which. Reused media keeps its file and key; its alt text changes to a given
   * one (`null` clears it) and is kept when `altText` is omitted. Refuses what `uploadMedia`
   * refuses. Media recorded without a content digest is never reused.
   */
  ensureMedia(input: MediaUploadInput): Promise<EnsuredMedia>;
  /** Changes the alt text; the file itself cannot be replaced. */
  updateMedia(id: string, changes: MediaUpdate): Promise<Media>;
  /**
   * Deletes the record, then the file. Attached media is refused and kept. A file that cannot be
   * removed is reported through `onCleanupFailure`; the deletion still succeeds.
   */
  deleteMedia(id: string): Promise<void>;
  /** A recorded file the API serves itself, or `null` for an unknown key or a missing file. */
  readMediaFile(key: string): Promise<MediaFile | null>;
}

export interface MediaServiceOptions {
  readonly storage: OpenedStorage;
  readonly limits: MediaLimits;
  /** Called for a stored file that could not be removed, so it can be logged and cleaned up. */
  onCleanupFailure(failure: CleanupFailure): void;
}

type Environment = Readonly<Record<string, string | undefined>>;

const positiveInteger = (value: string | undefined): number | null =>
  value !== undefined && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
    ? Number(value)
    : null;

/**
 * Reads the storage settings and the upload limits `MEDIA_MAX_BYTES` and
 * `MEDIA_MAX_IMAGE_DIMENSION` (positive integers). Throws an error naming every missing or invalid
 * variable, never their values.
 */
export function readMediaConfig(env: Environment, cwd: string = process.cwd()): MediaConfig {
  const problems: string[] = [];
  let storage: StorageConfig | null = null;
  try {
    storage = readStorageConfig(env, cwd);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  const maxBytes = positiveInteger(env["MEDIA_MAX_BYTES"]);
  const maxImageDimension = positiveInteger(env["MEDIA_MAX_IMAGE_DIMENSION"]);
  const invalid = [
    ...(maxBytes === null ? ["MEDIA_MAX_BYTES"] : []),
    ...(maxImageDimension === null ? ["MEDIA_MAX_IMAGE_DIMENSION"] : []),
  ];
  if (invalid.length > 0) {
    problems.push(
      `Invalid media configuration: set ${invalid.join(", ")} to positive integers (documented in .env.example)`,
    );
  }
  if (storage === null || maxBytes === null || maxImageDimension === null) {
    throw new Error(problems.join("; "));
  }
  return { storage, limits: { maxBytes, maxImageDimension } };
}

/**
 * Checks a file exactly as `uploadMedia` would, without storing or recording anything, so a caller
 * can refuse a whole batch before its first upload. Throws the refusal `uploadMedia` would throw.
 */
export function checkMediaUpload(input: MediaUploadInput, limits: MediaLimits): void {
  throw new Error(`Not implemented yet: ${input.filename} ${String(limits.maxBytes)}`);
}

export function createMediaService(
  persistence: MediaPersistence,
  options: MediaServiceOptions,
): MediaService {
  const { storage, files } = options.storage;

  const toMedia = (record: MediaRecord): Media => ({
    id: record.id,
    key: record.key,
    mediaType: record.mediaType,
    byteSize: record.byteSize,
    width: record.width,
    height: record.height,
    altText: record.altText,
    url: storage.publicAddress(record.key),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });

  const notFound = () => new DomainError("not_found", "There is no such media.");

  return {
    async listMedia() {
      return (await persistence.listMedia()).map(toMedia);
    },

    async getMedia(id) {
      const record = await persistence.findMedia(id);
      if (record === null) throw notFound();
      return toMedia(record);
    },

    async uploadMedia(input) {
      const inspected = inspectUpload(input, options.limits);
      const key = await storage.store({ bytes: input.bytes, extension: inspected.extension });
      try {
        return toMedia(
          await persistence.createMedia({
            key,
            mediaType: inspected.mediaType,
            byteSize: input.bytes.byteLength,
            width: inspected.width,
            height: inspected.height,
            altText: input.altText ?? null,
          }),
        );
      } catch (error) {
        await storage.delete(key).catch((cleanupError: unknown) => {
          options.onCleanupFailure({ operation: "upload", key, error: cleanupError });
        });
        throw error;
      }
    },

    ensureMedia(input) {
      return Promise.reject(new Error(`Not implemented yet: ${input.filename}`));
    },

    async updateMedia(id, changes) {
      if (changes.altText === undefined) {
        return this.getMedia(id);
      }
      const record = await persistence.updateMedia(id, { altText: changes.altText });
      if (record === null) throw notFound();
      return toMedia(record);
    },

    async deleteMedia(id) {
      const result = await persistence.deleteMedia(id);
      if (!result.ok) {
        if (result.reason === "referenced") {
          throw new DomainError(
            "conflict",
            "This media is attached to a person, organization or project; detach it first.",
          );
        }
        throw notFound();
      }
      const { key } = result.media;
      await storage.delete(key).catch((error: unknown) => {
        options.onCleanupFailure({ operation: "delete", key, error });
      });
    },

    async readMediaFile(key) {
      if (files === null) return null;
      const record = await persistence.findMediaByKey(key);
      if (record === null) return null;
      const bytes = await files.read(key);
      return bytes === null ? null : { bytes: Buffer.from(bytes), mediaType: record.mediaType };
    },
  };
}
