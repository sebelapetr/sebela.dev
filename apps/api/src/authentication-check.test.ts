// The authentication check: one private, read-only operation that answers whether the presented
// API key is valid now. MCP Admin calls it before discovery and on every request, so a revoked key
// stops working on its next operation. It reuses the API's own Bearer verification.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { anyText, bearer, connection, openTestBackend, type TestBackend } from "./test-support.js";

describe("GET /v1/authentication", () => {
  let backend: TestBackend;

  beforeAll(async () => {
    backend = await openTestBackend();
  });

  afterAll(async () => {
    await backend.close();
  });

  const check = (headers: Record<string, string> = {}, path = "/v1/authentication") =>
    backend.api().app.request(path, { headers }, connection());

  it("confirms a valid key and reveals nothing about it", async () => {
    const { key } = await backend.services.apiKeys.createKey("authentication check");

    const response = await check(bearer(key));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "authenticated" });
  });

  it("refuses a missing, malformed, unknown or revoked key the same way", async () => {
    const { key, metadata } = await backend.services.apiKeys.createKey("revoked check");
    await backend.services.apiKeys.revokeKey(metadata.id);
    const unknown = `sebela_0123456789abcdef_${"A".repeat(43)}`;

    for (const headers of [{}, { authorization: "Basic abc" }, bearer(unknown), bearer(key)]) {
      const response = await check(headers);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: { code: "unauthorized", message: anyText } });
    }
  });

  it("never accepts a key in the address", async () => {
    const { key } = await backend.services.apiKeys.createKey("address check");

    const response = await check({}, `/v1/authentication?api_key=${encodeURIComponent(key)}`);

    expect(response.status).toBe(400);
  });

  it("is documented as a private route", () => {
    expect(backend.api().routes).toContainEqual({
      method: "GET",
      path: "/v1/authentication",
      access: "private",
      hasBody: false,
      audit: null,
    });
  });
});
