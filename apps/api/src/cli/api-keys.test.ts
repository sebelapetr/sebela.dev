import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bearer,
  connection,
  json,
  openTestBackend,
  person,
  type TestBackend,
} from "../test-support.js";
import { runApiKeyCommand } from "./api-keys.js";

const KEY = /sebela_[0-9a-f]{16}_[A-Za-z0-9_-]{43}/g;

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    output: { out: (text: string) => out.push(text), err: (text: string) => err.push(text) },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

describe("the API-key CLI", () => {
  let backend: TestBackend;

  beforeAll(async () => {
    backend = await openTestBackend();
  });

  afterAll(async () => {
    await backend.close();
  });

  const run = async (...args: string[]) => {
    const io = capture();
    const code = await runApiKeyCommand(args, backend.services, io.output);
    return { code, out: io.out(), err: io.err() };
  };

  it("creates a key that works, lists it without secrets and revokes it", async () => {
    const created = await run("create", "first agent");
    expect(created.code).toBe(0);
    const keys = created.out.match(KEY) ?? [];
    expect(keys).toHaveLength(1);
    const key = keys[0] ?? "";

    const { app } = backend.api();
    const write = await app.request(
      "/v1/person",
      { method: "POST", ...json(person, bearer(key)) },
      connection(),
    );
    expect(write.status).toBe(201);

    const listed = await run("list");
    expect(listed.code).toBe(0);
    expect(listed.out).toContain("first agent");
    expect(listed.out).not.toMatch(KEY);
    // The secret is everything after `sebela_<16 hex public id>_` and may itself contain `_`.
    const secret = /^sebela_[0-9a-f]{16}_([A-Za-z0-9_-]{43})$/.exec(key)?.[1] ?? "";
    expect(secret).toHaveLength(43);
    expect(listed.out).not.toContain(secret);
    const [metadata] = await backend.services.apiKeys.listKeys();
    expect(listed.out).toContain(metadata?.id);

    const revoked = await run("revoke", metadata?.id ?? "");
    expect(revoked.code).toBe(0);
    expect(revoked.out).not.toMatch(KEY);
    const refused = await app.request(
      "/v1/person",
      { method: "DELETE", headers: bearer(key) },
      connection(),
    );
    expect(refused.status).toBe(401);
  });

  it("lets several named keys exist side by side", async () => {
    await run("create", "laptop");
    await run("create", "ci");

    const listed = await run("list");

    expect(listed.out).toContain("laptop");
    expect(listed.out).toContain("ci");
  });

  it("explains its usage and fails on unknown or incomplete commands", async () => {
    for (const args of [[], ["rotate"], ["create"], ["revoke"]]) {
      const result = await run(...args);

      expect(result.code, args.join(" ")).toBe(2);
      expect(result.err).toMatch(/usage/i);
    }
  });

  it("reports an unknown key id without a stack trace", async () => {
    const result = await run("revoke", "00000000-0000-4000-8000-000000000000");

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/no key/i);
    expect(result.err).not.toMatch(/\n\s+at /);
  });

  it("runs as its own process against a migrated database, without an HTTP server", async () => {
    const entry = fileURLToPath(new URL("./api-keys.ts", import.meta.url));
    const { config } = backend.database;
    const env = {
      ...process.env,
      POSTGRES_HOST: config.host,
      POSTGRES_PORT: String(config.port),
      DATABASE_NAME: config.name,
      DATABASE_USER: config.user,
      DATABASE_PASSWORD: config.password,
    };
    const cli = (...args: string[]) =>
      promisify(execFile)(process.execPath, ["--import", "tsx", entry, ...args], { env });

    const created = await cli("create", "process");
    const key = (created.stdout.match(KEY) ?? [])[0] ?? "";
    const listed = await cli("list");

    expect(key).not.toBe("");
    expect(listed.stdout).toContain("process");
    expect(listed.stdout).not.toContain(key);
    await expect(backend.services.apiKeys.verifyKey(key)).resolves.toMatchObject({ ok: true });
  });
});
