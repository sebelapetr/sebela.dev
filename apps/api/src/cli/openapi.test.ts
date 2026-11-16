import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { describeApi } from "../app.js";
import { connection, openTestBackend, type TestBackend } from "../test-support.js";

const run = promisify(execFile);
const command = fileURLToPath(new URL("./openapi.ts", import.meta.url));

/** Runs the export command with no configuration at all: no database, no API settings, no keys. */
const exportTo = (file: string) =>
  run(process.execPath, ["--import", "tsx", command, file], {
    env: { PATH: process.env["PATH"] ?? "" },
  });

describe("exporting the OpenAPI document", () => {
  let backend: TestBackend;
  let served: unknown;
  let folder: string;

  beforeAll(async () => {
    backend = await openTestBackend();
    const response = await backend.api().app.request("/openapi.json", {}, connection());
    served = await response.json();
    folder = await mkdtemp(join(tmpdir(), "sebela-openapi-"));
  });

  afterAll(async () => {
    await backend.close();
    await rm(folder, { recursive: true, force: true });
  });

  it("describes exactly the document the running API serves, without services", () => {
    expect(describeApi()).toEqual(served);
  });

  it("writes it as stable JSON without a database or any configuration", async () => {
    const first = join(folder, "first.json");
    const second = join(folder, "second.json");

    await exportTo(first);
    await exportTo(second);

    const written = await readFile(first, "utf8");
    expect(JSON.parse(written)).toEqual(served);
    expect(written).toBe(`${JSON.stringify(served, null, 2)}\n`);
    expect(await readFile(second, "utf8")).toBe(written);
  });

  it("refuses to run without a target file", async () => {
    await expect(
      run(process.execPath, ["--import", "tsx", command], {
        env: { PATH: process.env["PATH"] ?? "" },
      }),
    ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("Usage") as unknown });
  });
});
