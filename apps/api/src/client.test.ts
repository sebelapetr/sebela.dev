// Consumer contract tests: the generated `@sebela/api-client` calls the real app over a temporary
// database, exactly as a server-side consumer would, and handles every documented outcome through
// the contract's types. A route change regenerates the client and extends these cases.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiClient, type ApiClient, type ErrorResponse } from "@sebela/api-client";

import type { AppDependencies } from "./app.js";
import {
  anyText,
  connection,
  openTestBackend,
  person,
  testConfig,
  type TestBackend,
} from "./test-support.js";

/** A base address from the reserved `.test` domain; requests never leave the process. */
const BASE_URL = "http://api.test";

interface Consumer {
  readonly client: ApiClient;
  /** The `Authorization` header of every request the client sent, in order. */
  readonly authorizations: (string | null)[];
}

describe("the generated API client", () => {
  let backend: TestBackend;
  let key: string;

  /** A client over a fresh app, so each case has its own rate-limit counters. */
  const consumer = (
    apiKey?: string,
    overrides: Partial<Omit<AppDependencies, "services">> = {},
  ): Consumer => {
    const { app } = backend.api(overrides);
    const authorizations: (string | null)[] = [];
    const client = createApiClient({
      baseUrl: BASE_URL,
      ...(apiKey === undefined ? {} : { apiKey }),
      fetch: async (request) => {
        authorizations.push(request.headers.get("authorization"));
        return app.fetch(request, connection());
      },
    });
    return { client, authorizations };
  };

  beforeAll(async () => {
    backend = await openTestBackend();
    ({ key } = await backend.services.apiKeys.createKey("consumer contract"));
  });

  afterAll(async () => {
    await backend.close();
  });

  it("reads the public person: not found before it exists, then the person", async () => {
    const { client, authorizations } = consumer(key);

    const missing = await client.GET("/v1/person");
    expect(missing.response.status).toBe(404);
    expect(missing.data).toBeUndefined();
    expect(missing.error).toEqual({ error: { code: "not_found", message: anyText } });

    const created = await client.POST("/v1/person", { body: person });
    expect(created.response.status).toBe(201);

    const found = await client.GET("/v1/person");
    expect(found.error).toBeUndefined();
    expect(found.data).toMatchObject(person);

    // The key goes only to the operation whose contract requires it.
    expect(authorizations).toEqual([null, `Bearer ${key}`, null]);
  });

  it("creates and updates through authenticated writes", async () => {
    const { client } = consumer(key);

    const updated = await client.PATCH("/v1/person", { body: { headline: "Platform engineer" } });
    expect(updated.response.status).toBe(200);
    expect(updated.data?.headline).toBe("Platform engineer");

    const conflict = await client.POST("/v1/person", { body: person });
    expect(conflict.response.status).toBe(409);
    expect(conflict.error?.error.code).toBe("conflict");
  });

  it("reports validation failures with their fields", async () => {
    const { client } = consumer(key);

    const invalid = await client.PATCH("/v1/person", { body: { name: "" } });
    expect(invalid.response.status).toBe(400);
    const error: ErrorResponse | undefined = invalid.error;
    expect(error?.error.code).toBe("validation_failed");
    expect(error?.error.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "name" })]),
    );
  });

  it("is refused without a key and with a wrong key", async () => {
    for (const apiKey of [undefined, "sebela_not-a-real-key"]) {
      const { client, authorizations } = consumer(apiKey);
      const refused = await client.DELETE("/v1/person");
      expect(refused.response.status).toBe(401);
      expect(refused.response.headers.get("www-authenticate")).toBe("Bearer");
      expect(refused.error?.error.code).toBe("unauthorized");
      expect(authorizations).toEqual([apiKey === undefined ? null : `Bearer ${apiKey}`]);
    }
  });

  it("reports an exhausted budget with Retry-After", async () => {
    const once = { max: 1, windowMs: 30_000 };
    const { client } = consumer(undefined, {
      config: testConfig({ rateLimits: { public: once } }),
    });

    expect((await client.GET("/v1/person")).response.status).toBe(200);
    const limited = await client.GET("/v1/person");
    expect(limited.response.status).toBe(429);
    expect(limited.response.headers.get("retry-after")).toBe("30");
    expect(limited.error?.error.code).toBe("rate_limited");
  });

  it("deletes the person with the key", async () => {
    const { client } = consumer(key);

    const deleted = await client.DELETE("/v1/person");
    expect(deleted.response.status).toBe(204);
    expect(deleted.error).toBeUndefined();
    expect((await client.GET("/v1/person")).response.status).toBe(404);
  });
});
