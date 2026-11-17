import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runStorageCommand } from "./storage.js";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    output: { out: (text: string) => out.push(text), err: (text: string) => err.push(text) },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

const owner = "feat-1-fictional";

describe("the storage CLI", () => {
  let scratch: string;
  let root: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), "sebela-storage-cli-"));
    root = join(scratch, "storage");
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  const env = (overrides: Record<string, string> = {}) => ({
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_ROOT: root,
    STORAGE_ENVIRONMENT: "development",
    STORAGE_WORKTREE: "fictional-a1b2c3",
    STORAGE_PUBLIC_BASE_URL: "https://media.example.test/files",
    ...overrides,
  });

  const run = async (args: string[], environment = env()) => {
    const io = capture();
    const code = await runStorageCommand(args, environment, io.output, scratch);
    return { code, out: io.out(), err: io.err() };
  };

  const namespaceFolder = () => join(root, "development", "fictional-a1b2c3");

  it("prepares the worktree's namespace, then reuses it", async () => {
    const first = await run(["prepare", owner]);
    expect(first.code, first.err).toBe(0);
    expect(first.out).toMatch(/created/);
    expect(await readdir(namespaceFolder())).toEqual([".owner"]);

    const again = await run(["prepare", owner]);
    expect(again.code, again.err).toBe(0);
    expect(again.out).toMatch(/reused/);
  });

  it("removes its own namespace and reports an absent one", async () => {
    await run(["prepare", owner]);
    await writeFile(join(namespaceFolder(), "kept-until-removed.png"), "fictional");

    const removed = await run(["remove", owner]);
    expect(removed.code, removed.err).toBe(0);
    expect(removed.out).toMatch(/removed/);
    expect(existsSync(namespaceFolder())).toBe(false);

    const absent = await run(["remove", owner]);
    expect(absent.code, absent.err).toBe(0);
    expect(absent.out).toMatch(/absent|nothing/);
  });

  it("refuses another worktree's namespace with exit code 1 and keeps it", async () => {
    await run(["prepare", "feat-2-other"]);

    const result = await run(["remove", owner]);

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/refusing/);
    expect(await readdir(namespaceFolder())).toEqual([".owner"]);
  });

  it("refuses a configuration without a worktree prefix", async () => {
    const shared = join(root, "development");
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, "kept.png"), "fictional");

    const result = await run(["remove", owner], env({ STORAGE_WORKTREE: "" }));

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/refusing/);
    expect(await readdir(shared)).toEqual(["kept.png"]);
  });

  it("reports invalid storage settings by name, without their values", async () => {
    const result = await run(
      ["prepare", owner],
      env({ STORAGE_DRIVER: "bunny-s3", STORAGE_BUNNY_PASSWORD: "fictional secret value" }),
    );

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/STORAGE_BUNNY_ENDPOINT/);
    expect(result.err).not.toContain("fictional secret value");
  });

  it("explains its usage on a missing or unknown command", async () => {
    for (const args of [[], ["prepare"], ["remove"], ["wipe", owner], ["prepare", owner, "x"]]) {
      const result = await run(args);

      expect(result.code, args.join(" ")).toBe(2);
      expect(result.err).toMatch(/usage/i);
    }
  });

  it("runs as its own process without a database or an HTTP server", async () => {
    const entry = fileURLToPath(new URL("./storage.ts", import.meta.url));

    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", entry, "prepare", owner],
      { env: { ...process.env, ...env() } },
    );

    expect(stdout).toMatch(/created/);
    expect(await readdir(namespaceFolder())).toEqual([".owner"]);
  });
});
