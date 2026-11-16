// Test support for the API's own tests; excluded from the build.
import { expect } from "vitest";

import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/services/testing";
import { openServices, readDatabaseConfig, type Services } from "@sebela/services";

import { createApp, type Api, type AppDependencies } from "./app.js";
import type { ApiConfig, RatePolicy } from "./config.js";

/** A fictional client address from the documentation range (RFC 5737). */
export const CLIENT = "192.0.2.10";

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
    trustedProxies: [],
    ...rest,
    rateLimits: {
      health: roomy,
      public: roomy,
      private: roomy,
      key: roomy,
      maxTrackedCallers: 1_000,
      ...rateLimits,
    },
  };
}

/** Bindings as `@hono/node-server` passes them: the connection the request arrived on. */
export function connection(remoteAddress: string = CLIENT) {
  return { incoming: { socket: { remoteAddress, remotePort: 50_000, remoteFamily: "IPv4" } } };
}

/** A temporary migrated database with services over it, for one test file. */
export interface TestBackend {
  readonly services: Services;
  readonly database: TemporaryDatabase;
  /** A fresh app over the same services, with its own rate-limit counters. */
  api(overrides?: Partial<Omit<AppDependencies, "services">>): Api;
  close(): Promise<void>;
}

export async function openTestBackend(options: { now?: () => Date } = {}): Promise<TestBackend> {
  const database = await createTemporaryDatabase(readDatabaseConfig(process.env));
  const services = openServices(
    database.config,
    options.now ? { apiKeys: { now: options.now } } : {},
  );
  return {
    services,
    database,
    api: (overrides = {}) =>
      createApp({ services, config: testConfig(), log: () => undefined, ...overrides }),
    async close() {
      await services.close();
      await database.drop();
    },
  };
}

export const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

export const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

/** A valid person to create, fictional. */
export const person = {
  name: "Alex Example",
  headline: "Backend engineer",
  shortBio: "Builds **careful** systems.",
};

/** Matches any error message; the tests assert codes, the wording may change. */
export const anyText = expect.any(String) as unknown;
