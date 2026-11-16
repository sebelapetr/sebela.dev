import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { RouteSummary } from "../app.js";
import {
  anyText,
  bearer,
  connection,
  json,
  openTestBackend,
  person,
  type TestBackend,
} from "../test-support.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Bodies and content types a write might arrive with: none of them may reach validation first.
const attempts: { name: string; init: RequestInit }[] = [
  { name: "a valid body", init: json(person) },
  { name: "an invalid body", init: json({ name: 42, unexpected: true }) },
  {
    name: "malformed JSON",
    init: { headers: { "content-type": "application/json" }, body: "{not json" },
  },
  {
    name: "an unsupported content type",
    init: { headers: { "content-type": "text/plain" }, body: "x" },
  },
  { name: "no body", init: {} },
];

// Keys that must all be refused the same way.
const refusedKeys: { name: string; headers: () => Record<string, string> }[] = [
  { name: "no Authorization header", headers: () => ({}) },
  { name: "another scheme", headers: () => ({ authorization: "Basic dXNlcjpwYXNz" }) },
  { name: "an empty bearer", headers: () => ({ authorization: "Bearer " }) },
  { name: "a malformed key", headers: () => bearer("not-a-key") },
  {
    name: "an unknown key",
    headers: () => bearer(`sebela_${"0".repeat(16)}_${"A".repeat(43)}`),
  },
];

describe("authentication of the private routes", () => {
  let backend: TestBackend;
  let revokedKey: string;

  beforeAll(async () => {
    backend = await openTestBackend();
    const revoked = await backend.services.apiKeys.createKey("revoked caller");
    await backend.services.apiKeys.revokeKey(revoked.metadata.id);
    revokedKey = revoked.key;
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    await backend.services.profile.deletePerson().catch(() => undefined);
  });

  it("registers private routes, and every write route is one of them", () => {
    const { app, routes } = backend.api();
    const registered = app.routes.filter((route) => route.method !== "ALL");
    const writes = registered.filter((route) => WRITE_METHODS.has(route.method));

    expect(routes.some((route) => route.access === "private")).toBe(true);
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(routes).toContainEqual(
        expect.objectContaining({ method: write.method, path: write.path, access: "private" }),
      );
    }
    for (const route of registered) {
      expect(routes).toContainEqual(
        expect.objectContaining({ method: route.method, path: route.path }),
      );
    }
  });

  it("refuses every private route without a valid key, before body handling", async () => {
    const privateRoutes = backend.api().routes.filter((route) => route.access === "private");
    const keys = [...refusedKeys, { name: "a revoked key", headers: () => bearer(revokedKey) }];

    for (const route of privateRoutes) {
      for (const key of keys) {
        for (const attempt of attempts) {
          // A fresh app for every request: a fresh rate-limit budget, so a 429 cannot pass for a 401.
          const response = await send(backend, route, attempt.init, key.headers());

          expect(
            response.status,
            `${route.method} ${route.path}, ${key.name}, ${attempt.name}`,
          ).toBe(401);
          expect(await response.json()).toEqual({
            error: { code: "unauthorized", message: anyText },
          });
          expect(response.headers.get("www-authenticate")).toBe("Bearer");
        }
      }
    }
    // Nothing was written by any of the refused requests.
    await expect(backend.services.profile.getPerson()).rejects.toMatchObject({ code: "not_found" });
    await expect(backend.services.profile.listTechnologies()).resolves.toEqual([]);
    await expect(backend.services.profile.listTopics()).resolves.toEqual([]);
    await expect(backend.services.profile.listOrganizations()).resolves.toEqual([]);
    await expect(backend.services.profile.listExperiences()).resolves.toEqual([]);
    await expect(backend.services.profile.listProjects()).resolves.toEqual([]);
    await expect(backend.services.profile.listExplorations()).resolves.toEqual([]);
  });

  it("permits a valid key, and refuses it on the next request after revocation", async () => {
    const created = await backend.services.apiKeys.createKey("agent");
    const { app } = backend.api();

    const allowed = await app.request(
      "/v1/person",
      { method: "POST", ...withHeaders(json(person), bearer(created.key)) },
      connection(),
    );
    expect(allowed.status).toBe(201);

    await backend.services.apiKeys.revokeKey(created.metadata.id);
    const refused = await app.request(
      "/v1/person",
      { method: "DELETE", headers: bearer(created.key) },
      connection(),
    );
    expect(refused.status).toBe(401);
    await expect(backend.services.profile.getPerson()).resolves.toMatchObject({
      name: person.name,
    });
  });

  it("records the time a key was last used", async () => {
    const created = await backend.services.apiKeys.createKey("timed");
    await backend
      .api()
      .app.request("/v1/person", { method: "DELETE", headers: bearer(created.key) }, connection());

    const listed = await backend.services.apiKeys.listKeys();
    expect(listed.find((key) => key.id === created.metadata.id)?.lastUsedAt).not.toBeNull();
  });

  it("refuses keys in query parameters on every route, even valid ones", async () => {
    const created = await backend.services.apiKeys.createKey("query");
    const { app } = backend.api();

    for (const query of [`api_key=${created.key}`, `token=${created.key}`, `x=${created.key}`]) {
      const read = await app.request(`/v1/person?${query}`, {}, connection());
      const write = await app.request(
        `/v1/person?${query}`,
        { method: "POST", ...json(person) },
        connection(),
      );
      for (const response of [read, write]) {
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: { code: "credentials_in_url" } });
      }
    }
    await expect(backend.services.profile.getPerson()).rejects.toMatchObject({ code: "not_found" });
  });

  it("keeps keys out of the request log", async () => {
    const created = await backend.services.apiKeys.createKey("logged");
    const lines: string[] = [];
    const { app } = backend.api({ log: (line) => lines.push(line) });

    await app.request(
      "/v1/person",
      { method: "DELETE", headers: bearer(created.key) },
      connection(),
    );
    await app.request(`/v1/person?api_key=${created.key}`, {}, connection());
    await app.request(`/v1/${created.key}`, {}, connection());

    expect(lines.length).toBeGreaterThanOrEqual(3);
    const secret = created.key.split("_")[2] ?? created.key;
    for (const line of lines) expect(line).not.toContain(secret);
  });
});

/** Fills path parameters with well-formed values, so a refusal is never a 404 or a bad parameter. */
function concretePath(path: string): string {
  return path.replace(/:[A-Za-z]+/g, "fictional-example");
}

function withHeaders(init: RequestInit, headers: Record<string, string>): RequestInit {
  return { ...init, headers: { ...(init.headers as Record<string, string>), ...headers } };
}

function send(
  backend: TestBackend,
  route: RouteSummary,
  init: RequestInit,
  headers: Record<string, string>,
) {
  return backend
    .api()
    .app.request(
      concretePath(route.path),
      { method: route.method, ...withHeaders(init, headers) },
      connection(),
    );
}
