import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openStorage, readStorageConfig, type StorageConfig } from "./index.js";

const environment = {
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_ROOT: "/srv/fictional-storage",
  STORAGE_ENVIRONMENT: "development",
  STORAGE_WORKTREE: "feature-a",
  STORAGE_PUBLIC_BASE_URL: "https://media.example.test/files/",
};

const fileName = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|pdf)$/;

/** Every file below a folder, as paths relative to it. */
async function filesBelow(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) => join(entry.parentPath, entry.name).slice(folder.length + 1))
    .sort();
}

describe("readStorageConfig", () => {
  it("reads the local driver with its prefix and public base", () => {
    expect(readStorageConfig(environment)).toEqual({
      driver: "local",
      root: "/srv/fictional-storage",
      environment: "development",
      worktree: "feature-a",
      publicBaseUrl: "https://media.example.test/files",
    });
  });

  it("resolves a relative root against the given working folder", () => {
    const config = readStorageConfig(
      { ...environment, STORAGE_LOCAL_ROOT: "../../.tmp/storage" },
      "/srv/checkout/apps/api",
    );
    expect(config.root).toBe("/srv/checkout/.tmp/storage");
  });

  it("treats an empty or missing worktree as none", () => {
    expect(readStorageConfig({ ...environment, STORAGE_WORKTREE: "" }).worktree).toBeNull();
    expect(readStorageConfig({ ...environment, STORAGE_WORKTREE: undefined }).worktree).toBeNull();
  });

  it("names every missing or invalid variable without its value", () => {
    const attempt = () =>
      readStorageConfig({
        STORAGE_DRIVER: "local",
        STORAGE_ENVIRONMENT: "../secret-value",
        STORAGE_WORKTREE: "Not Valid",
        STORAGE_PUBLIC_BASE_URL: "ftp://secret-host.example.test",
      });
    expect(attempt).toThrow(/STORAGE_LOCAL_ROOT/);
    expect(attempt).toThrow(/STORAGE_ENVIRONMENT/);
    expect(attempt).toThrow(/STORAGE_WORKTREE/);
    expect(attempt).toThrow(/STORAGE_PUBLIC_BASE_URL/);
    expect(attempt).not.toThrow(/secret/);
  });

  it.each([undefined, "", "s3", "LOCAL"])("refuses the driver %j", (driver) => {
    expect(() => readStorageConfig({ ...environment, STORAGE_DRIVER: driver })).toThrow(
      /STORAGE_DRIVER/,
    );
  });

  it("refuses the Bunny driver until it exists instead of writing to local disk", () => {
    expect(() =>
      readStorageConfig({ ...environment, STORAGE_DRIVER: "bunny-s3", STORAGE_LOCAL_ROOT: "" }),
    ).toThrow(/bunny-s3/);
    expect(() => readStorageConfig({ ...environment, STORAGE_DRIVER: "bunny-s3" })).toThrow(
      /bunny-s3/,
    );
  });
});

describe("local storage", () => {
  let base: string;
  let root: string;
  let outside: string;
  let config: StorageConfig;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "sebela-storage-"));
    root = join(base, "root");
    outside = join(base, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "decoy.png"), "decoy");
    config = {
      driver: "local",
      root,
      environment: "development",
      worktree: "feature-a",
      publicBaseUrl: "https://media.example.test/files",
    };
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("stores a file under the environment and worktree prefix with a generated name", async () => {
    const { storage, files } = openStorage(config);

    const key = await storage.store({ bytes: Buffer.from("first"), extension: "png" });

    const [environmentFolder, worktreeFolder, name] = key.split("/");
    expect([environmentFolder, worktreeFolder]).toEqual(["development", "feature-a"]);
    expect(name).toMatch(fileName);
    await expect(readFile(join(root, key), "utf8")).resolves.toBe("first");
    await expect(files?.read(key)).resolves.toEqual(Buffer.from("first"));
    expect(storage.publicAddress(key)).toBe(`https://media.example.test/files/${key}`);
  });

  it("stores directly under the environment without a worktree", async () => {
    const { storage } = openStorage({ ...config, worktree: null });

    const key = await storage.store({ bytes: Buffer.from("%PDF"), extension: "pdf" });

    expect(key).toMatch(/^development\/[^/]+\.pdf$/);
    expect(key.split("/")[1]).toMatch(fileName);
  });

  it("never reuses a key, even for the same content", async () => {
    const { storage } = openStorage(config);
    const bytes = Buffer.from("same");

    const keys = await Promise.all([1, 2, 3].map(() => storage.store({ bytes, extension: "png" })));

    expect(new Set(keys).size).toBe(3);
    expect(await filesBelow(root)).toHaveLength(3);
  });

  it("deletes a file once and treats a missing file as deleted", async () => {
    const { storage, files } = openStorage(config);
    const key = await storage.store({ bytes: Buffer.from("x"), extension: "png" });

    await storage.delete(key);
    await storage.delete(key);

    await expect(files?.read(key)).resolves.toBeNull();
    expect(await filesBelow(root)).toEqual([]);
  });

  it.each([
    "../outside/decoy.png",
    "development/feature-a/../../../outside/decoy.png",
    "/etc/hostname",
    "development/other-worktree/0b8f5c2e-1d4a-4f6b-9c3e-2a7d8e9f0a1b.png",
    "production/feature-a/0b8f5c2e-1d4a-4f6b-9c3e-2a7d8e9f0a1b.png",
    "development/feature-a/decoy.png",
    "development/feature-a/0b8f5c2e-1d4a-4f6b-9c3e-2a7d8e9f0a1b.svg",
    "development/feature-a/0b8f5c2e-1d4a-4f6b-9c3e-2a7d8e9f0a1b.png/",
    "development\\feature-a\\0b8f5c2e-1d4a-4f6b-9c3e-2a7d8e9f0a1b.png",
    "development/feature-a/0b8f5c2e-1d4a-4f6b-9c3e-2a7d8e9f0a1b.png\0.txt",
  ])("refuses the key %j outside its prefix or layout", async (key) => {
    const { storage, files } = openStorage(config);
    await storage.store({ bytes: Buffer.from("x"), extension: "png" });

    await expect(files?.read(key)).resolves.toBeNull();
    await expect(storage.delete(key)).rejects.toThrow(/key/i);
    expect(storage.publicAddress(key)).toBeNull();
    await expect(readFile(join(outside, "decoy.png"), "utf8")).resolves.toBe("decoy");
  });

  it("refuses a prefix folder that is a symbolic link and writes nothing through it", async () => {
    await mkdir(join(root, "development"), { recursive: true });
    await symlink(outside, join(root, "development", "feature-a"));
    const { storage } = openStorage(config);

    await expect(storage.store({ bytes: Buffer.from("x"), extension: "png" })).rejects.toThrow();

    expect(await filesBelow(outside)).toEqual(["decoy.png"]);
  });

  it("neither reads nor follows a stored name that is a symbolic link", async () => {
    const { storage, files } = openStorage(config);
    const key = await storage.store({ bytes: Buffer.from("x"), extension: "png" });
    await rm(join(root, key));
    await symlink(join(outside, "decoy.png"), join(root, key));

    await expect(files?.read(key)).resolves.toBeNull();
    await storage.delete(key);

    expect(existsSync(join(root, key))).toBe(false);
    await expect(readFile(join(outside, "decoy.png"), "utf8")).resolves.toBe("decoy");
  });

  it("does not read a folder stored under a valid name", async () => {
    const { storage, files } = openStorage(config);
    const key = await storage.store({ bytes: Buffer.from("x"), extension: "png" });
    await rm(join(root, key));
    await mkdir(join(root, key));

    await expect(files?.read(key)).resolves.toBeNull();
  });

  it("refuses to store an extension outside the allowlist", async () => {
    const { storage } = openStorage(config);

    await expect(
      storage.store({ bytes: Buffer.from("x"), extension: "svg" as "png" }),
    ).rejects.toThrow(/extension/i);
    expect(existsSync(root) ? await filesBelow(root) : []).toEqual([]);
  });
});
