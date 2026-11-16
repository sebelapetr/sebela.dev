import type { Media, MediaType, MediaUpdate } from "@sebela/contracts";
import type { ProfilePersistence } from "@sebela/db";

import type { OpenedStorage, StorageConfig } from "../storage/index.js";

export interface MediaLimits {
  readonly maxBytes: number;
  readonly maxImageDimension: number;
}

export interface MediaConfig {
  readonly storage: StorageConfig;
  readonly limits: MediaLimits;
}

export interface CleanupFailure {
  readonly operation: "upload" | "delete";
  readonly key: string;
  readonly error: unknown;
}

export interface MediaUploadInput {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly declaredType: string;
  readonly altText?: string | null | undefined;
}

export interface MediaFile {
  readonly bytes: Uint8Array;
  readonly mediaType: MediaType;
}

export interface MediaService {
  listMedia(): Promise<Media[]>;
  getMedia(id: string): Promise<Media>;
  uploadMedia(input: MediaUploadInput): Promise<Media>;
  updateMedia(id: string, changes: MediaUpdate): Promise<Media>;
  deleteMedia(id: string): Promise<void>;
  readMediaFile(key: string): Promise<MediaFile | null>;
}

export interface MediaServiceOptions {
  readonly storage: OpenedStorage;
  readonly limits: MediaLimits;
  onCleanupFailure(failure: CleanupFailure): void;
}

export function readMediaConfig(
  _env: Readonly<Record<string, string | undefined>>,
  _cwd: string = process.cwd(),
): MediaConfig {
  throw new Error(`Not implemented yet: ${typeof _env}, ${typeof _cwd}.`);
}

export function createMediaService(
  _persistence: ProfilePersistence,
  _options: MediaServiceOptions,
): MediaService {
  throw new Error(`Not implemented yet: ${typeof _persistence}, ${typeof _options}.`);
}
