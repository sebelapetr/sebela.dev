// Test support for the API's own tests; excluded from the build.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { expect } from "vitest";

import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/services/testing";
import {
  openServices,
  readDatabaseConfig,
  type CleanupFailure,
  type MediaLimits,
  type Services,
} from "@sebela/services";

import { createApp, type Api, type AppDependencies } from "./app.js";
import type { ApiConfig, RatePolicy } from "./config.js";

/** A fictional client address from the documentation range (RFC 5737). */
export const CLIENT = "192.0.2.10";

/** Small upload limits, so the tests can exceed them cheaply. */
export const MEDIA_LIMITS: MediaLimits = { maxBytes: 64 * 1024, maxImageDimension: 2000 };

/** The fictional public base the test storage computes addresses from. */
export const MEDIA_PUBLIC_BASE = "https://media.example.test/files";

/** Generous budgets, so a test only meets a limit it sets itself. */
const roomy: RatePolicy = { max: 10_000, windowMs: 60_000 };

export function testConfig(
  overrides: Partial<Omit<ApiConfig, "rateLimits">> & {
    rateLimits?: Partial<ApiConfig["rateLimits"]>;
  } = {},
): ApiConfig {
  const { rateLimits, ...rest } = overrides;
  return {
    host: "test",
    port: 0,
    bodyLimitBytes: 16 * 1024,
    uploadLimitBytes: MEDIA_LIMITS.maxBytes,
    trustedProxies: [],
    websiteInvalidation: null,
    ...rest,
    rateLimits: {
      health: roomy,
      public: roomy,
      private: roomy,
      key: roomy,
      upload: roomy,
      maxTrackedCallers: 1_000,
      ...rateLimits,
    },
  };
}

/** Bindings as `@hono/node-server` passes them: the connection the request arrived on. */
export function connection(remoteAddress: string = CLIENT) {
  return { incoming: { socket: { remoteAddress, remotePort: 50_000, remoteFamily: "IPv4" } } };
}

/**
 * A temporary migrated database with services over it, for one test file. Media are stored locally
 * below a fresh temporary folder, in the `test` environment.
 */
export interface TestBackend {
  readonly services: Services;
  readonly database: TemporaryDatabase;
  /** The temporary local storage root. */
  readonly storageRoot: string;
  /** The stored files, as paths relative to the storage root, sorted. */
  storedFiles(): Promise<string[]>;
  /** The files the media workflow reported it could not remove. */
  readonly cleanupFailures: CleanupFailure[];
  /** A fresh app over the same services, with its own rate-limit counters. */
  api(overrides?: Partial<Omit<AppDependencies, "services">>): Api;
  close(): Promise<void>;
}

export async function openTestBackend(options: { now?: () => Date } = {}): Promise<TestBackend> {
  const database = await createTemporaryDatabase(readDatabaseConfig(process.env));
  const storageRoot = await mkdtemp(join(tmpdir(), "sebela-api-media-"));
  const cleanupFailures: CleanupFailure[] = [];
  const services = openServices(database.config, {
    ...(options.now ? { apiKeys: { now: options.now } } : {}),
    media: {
      config: {
        storage: {
          driver: "local",
          root: storageRoot,
          environment: "test",
          worktree: null,
          publicBaseUrl: MEDIA_PUBLIC_BASE,
        },
        limits: MEDIA_LIMITS,
      },
      onCleanupFailure: (failure) => cleanupFailures.push(failure),
    },
  });
  return {
    services,
    database,
    storageRoot,
    cleanupFailures,
    async storedFiles() {
      const entries = await readdir(storageRoot, { recursive: true, withFileTypes: true });
      return entries
        .filter((entry) => !entry.isDirectory())
        .map((entry) => relative(storageRoot, join(entry.parentPath, entry.name)))
        .sort();
    },
    api: (overrides = {}) =>
      createApp({ services, config: testConfig(), log: () => undefined, ...overrides }),
    async close() {
      await services.close();
      await database.drop();
      await rm(storageRoot, { recursive: true, force: true });
    },
  };
}

export const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

/** A `multipart/form-data` upload of one file, with optional further fields. */
export function upload(
  file: { bytes: Uint8Array; name: string; type?: string },
  fields: Record<string, string> = {},
  headers: Record<string, string> = {},
): RequestInit {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.type ?? "" }), file.name);
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return { body: form, headers };
}

export const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

/** A valid person to create, fictional. */
export const person = {
  name: "Alex Example",
  headline: "Backend engineer",
  shortBio: "Builds **careful** systems.",
};

/** Matches any error message; the tests assert codes, the wording may change. */
export const anyText = expect.any(String) as unknown;
