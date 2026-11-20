import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openServices } from "@sebela/services";

import { createApp } from "./app.js";
import {
  anyText,
  connection,
  openTestBackend,
  testConfig,
  type TestBackend,
} from "./test-support.js";

describe("readiness", () => {
  let backend: TestBackend;

  beforeAll(async () => {
    backend = await openTestBackend();
  });

  afterAll(async () => {
    await backend.close();
  });

  it("answers ready without a key while the database answers", async () => {
    const response = await backend.api().app.request("/health/ready", {}, connection());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ready" });
  });

  it("answers 503 unavailable, without details, when the database cannot be reached", async () => {
    const missing = `missing_${randomBytes(6).toString("hex")}`;
    const broken = openServices({ ...backend.database.config, name: missing });
    const lines: string[] = [];
    const { app } = createApp({
      services: broken,
      config: testConfig(),
      log: (line) => lines.push(line),
    });

    const response = await app.request("/health/ready", {}, connection());
    await broken.close();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: { code: "unavailable", message: anyText } });
    expect(text).not.toContain(missing);
    expect(lines.join("\n")).not.toContain(missing);
  });

  it("keeps liveness apart: /health answers even when the database cannot be reached", async () => {
    const missing = `missing_${randomBytes(6).toString("hex")}`;
    const broken = openServices({ ...backend.database.config, name: missing });
    const { app } = createApp({ services: broken, config: testConfig(), log: () => undefined });

    const response = await app.request("/health", {}, connection());
    await broken.close();

    expect(response.status).toBe(200);
  });

  it("counts against the health budget, not the public one", async () => {
    const { app } = backend.api({
      config: testConfig({ rateLimits: { health: { max: 1, windowMs: 60_000 } } }),
    });

    expect((await app.request("/health/ready", {}, connection())).status).toBe(200);
    expect((await app.request("/health/ready", {}, connection())).status).toBe(429);
    expect((await app.request("/v1/topics", {}, connection())).status).toBe(200);
  });
});
