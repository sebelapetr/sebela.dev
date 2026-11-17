import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createBunnyS3Driver,
  createBunnyS3NamespaceStore,
  type S3Exchange,
  type S3Transport,
} from "./drivers/bunny-s3.js";
import {
  openStorage,
  openStorageNamespace,
  type BunnyS3StorageConfig,
  type Storage,
  type StorageNamespace,
} from "./index.js";
import { ownedNamespace } from "./namespace.js";

interface Layout {
  readonly environment: string;
  readonly worktree: string | null;
}

const own: Layout = { environment: "development", worktree: "feature-a" };
const sibling: Layout = { environment: "development", worktree: "feature-b" };
const owner = "feat-1-feature-a";
const marker = `sebela worktree:${owner}\n`;
const png = { bytes: new Uint8Array(Buffer.from("fictional")), extension: "png" as const };

/** Every file below a folder, as paths relative to it. */
async function filesBelow(folder: string): Promise<string[]> {
  if (!existsSync(folder)) return [];
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) => join(entry.parentPath, entry.name).slice(folder.length + 1))
    .sort();
}

/**
 * An in-memory, path-style S3 endpoint with the requests the namespace needs: PUT, GET and DELETE of
 * one object and ListObjectsV2 by prefix, paged by `max-keys` and a continuation token.
 */
function fakeS3(config: BunnyS3StorageConfig, pageSize = 2) {
  const objects = new Map<string, Uint8Array>();
  const exchanges: S3Exchange[] = [];
  const error = (status: number, code: string) => ({
    status,
    headers: { "content-type": "application/xml" },
    body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`,
  });
  const escape = (text: string) =>
    text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

  const transport: S3Transport = (exchange) => {
    exchanges.push(exchange);
    const url = new URL(exchange.url);
    if (url.origin !== config.endpoint) return Promise.resolve(error(400, "InvalidRequest"));
    const signed = exchange.headers["authorization"] ?? "";
    if (!signed.startsWith(`AWS4-HMAC-SHA256 Credential=${config.zone}/`)) {
      return Promise.resolve(error(403, "InvalidAccessKeyId"));
    }
    const [, bucket, ...path] = url.pathname.split("/");
    if (bucket !== config.zone) return Promise.resolve(error(404, "NoSuchBucket"));
    const key = path.map(decodeURIComponent).join("/");

    if (exchange.method === "GET" && key === "" && url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const limit = Math.min(Number(url.searchParams.get("max-keys") ?? "1000"), pageSize);
      const after = url.searchParams.get("continuation-token") ?? "";
      const matching = [...objects.keys()]
        .filter((name) => name.startsWith(prefix) && name > after)
        .sort();
      const page = matching.slice(0, limit);
      const truncated = matching.length > page.length;
      const contents = page
        .map((name) => `<Contents><Key>${escape(name)}</Key><Size>1</Size></Contents>`)
        .join("");
      const next = truncated
        ? `<NextContinuationToken>${escape(page.at(-1) ?? "")}</NextContinuationToken>`
        : "";
      return Promise.resolve({
        status: 200,
        headers: { "content-type": "application/xml" },
        body: `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${config.zone}</Name><Prefix>${escape(prefix)}</Prefix><KeyCount>${String(page.length)}</KeyCount><MaxKeys>${String(limit)}</MaxKeys><IsTruncated>${String(truncated)}</IsTruncated>${contents}${next}</ListBucketResult>`,
      });
    }
    if (exchange.method === "GET") {
      const body = objects.get(key);
      if (body === undefined) return Promise.resolve(error(404, "NoSuchKey"));
      return Promise.resolve({
        status: 200,
        headers: { "content-length": String(body.byteLength) },
        body: Buffer.from(body).toString("utf8"),
      });
    }
    if (exchange.method === "PUT") {
      objects.set(key, new Uint8Array(exchange.body));
      return Promise.resolve({ status: 200, headers: { etag: '"fictional"' } });
    }
    if (exchange.method === "DELETE") {
      if (!objects.delete(key)) return Promise.resolve(error(404, "NoSuchKey"));
      return Promise.resolve({ status: 204 });
    }
    return Promise.resolve(error(501, "NotImplemented"));
  };

  return { objects, exchanges, transport };
}

/** One driver under test: its namespace and storage, and a view of what it holds. */
interface NamespaceHarness {
  namespace(layout: Layout, owner: string): StorageNamespace;
  storage(layout: Layout): Storage;
  /** Every stored key, the markers included. */
  keys(): Promise<string[]>;
  /** Places a file directly, as something other than the namespace would have. */
  place(key: string, content: string): Promise<void>;
  cleanup(): Promise<void>;
}

async function localHarness(): Promise<NamespaceHarness> {
  const base = await mkdtemp(join(tmpdir(), "sebela-namespace-"));
  const root = join(base, "root");
  const config = (layout: Layout) => ({
    driver: "local" as const,
    root,
    ...layout,
    publicBaseUrl: "https://media.example.test/files",
  });
  return {
    namespace: (layout, name) => openStorageNamespace(config(layout), name),
    storage: (layout) => openStorage(config(layout)).storage,
    keys: () => filesBelow(root),
    async place(key, content) {
      const path = join(root, key);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, content);
    },
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

const bunnyConfig = (layout: Layout): BunnyS3StorageConfig => ({
  driver: "bunny-s3",
  endpoint: "https://de-s3.storage.example.test",
  region: "de",
  zone: "fictional-dev-zone",
  password: "fictional-zone-password",
  ...layout,
  publicBaseUrl: "https://media.example.test/files",
});

function bunnyHarness(): Promise<NamespaceHarness> {
  const fake = fakeS3(bunnyConfig(own));
  return Promise.resolve({
    namespace: (layout, name) =>
      ownedNamespace(
        bunnyConfig(layout),
        name,
        createBunnyS3NamespaceStore(bunnyConfig(layout), fake.transport),
      ),
    storage: (layout) => createBunnyS3Driver(bunnyConfig(layout), fake.transport),
    keys: () => Promise.resolve([...fake.objects.keys()].sort()),
    place(key, content) {
      fake.objects.set(key, new Uint8Array(Buffer.from(content)));
      return Promise.resolve();
    },
    cleanup: () => Promise.resolve(),
  });
}

describe.each([
  ["local", localHarness],
  ["bunny-s3", bunnyHarness],
])("the %s storage namespace of a worktree", (_name, create) => {
  let harness: NamespaceHarness;

  beforeEach(async () => {
    harness = await create();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it("is created with an owner marker, then reused with its files", async () => {
    await expect(harness.namespace(own, owner).prepare()).resolves.toBe("created");
    expect(await harness.keys()).toEqual(["development/feature-a/.owner"]);
    const key = await harness.storage(own).store(png);

    await expect(harness.namespace(own, owner).prepare()).resolves.toBe("reused");
    expect(await harness.keys()).toEqual(["development/feature-a/.owner", key].sort());
  });

  it("refuses to prepare a namespace another worktree owns, and keeps it", async () => {
    await harness.place("development/feature-a/.owner", "sebela worktree:feat-2-other\n");

    await expect(harness.namespace(own, owner).prepare()).rejects.toThrow(/another worktree/);
    expect(await harness.keys()).toEqual(["development/feature-a/.owner"]);
  });

  it("refuses to adopt a namespace with files but without a marker", async () => {
    const key = await harness.storage(own).store(png);

    await expect(harness.namespace(own, owner).prepare()).rejects.toThrow(/no owner marker/);
    expect(await harness.keys()).toEqual([key]);
  });

  it("removes its own files and marker and keeps every other namespace", async () => {
    await harness.namespace(own, owner).prepare();
    await harness.storage(own).store(png);
    await harness.storage(own).store({ ...png, extension: "pdf" });
    await harness.storage(own).store(png);
    await harness.namespace(sibling, "feat-2-feature-b").prepare();
    const kept = await harness.storage(sibling).store(png);
    const elsewhere = await harness
      .storage({ environment: "development", worktree: null })
      .store(png);
    // A worktree whose name begins with this one's lies outside its prefix.
    await harness.place("development/feature-ab/kept.png", "kept");

    await expect(harness.namespace(own, owner).remove()).resolves.toBe("removed");

    expect(await harness.keys()).toEqual(
      ["development/feature-b/.owner", kept, elsewhere, "development/feature-ab/kept.png"].sort(),
    );
  });

  it("reports a namespace that does not exist as absent", async () => {
    await expect(harness.namespace(own, owner).remove()).resolves.toBe("absent");
    expect(await harness.keys()).toEqual([]);
  });

  it("refuses to remove a namespace another worktree owns, and keeps its files", async () => {
    await harness.namespace(own, "feat-2-other").prepare();
    const key = await harness.storage(own).store(png);

    await expect(harness.namespace(own, owner).remove()).rejects.toThrow(/another worktree/);
    expect(await harness.keys()).toEqual(["development/feature-a/.owner", key].sort());
  });

  it("refuses to remove files without an owner marker, and keeps them", async () => {
    const key = await harness.storage(own).store(png);

    await expect(harness.namespace(own, owner).remove()).rejects.toThrow(/no owner marker/);
    expect(await harness.keys()).toEqual([key]);
  });

  it.each([
    ["without a worktree prefix", { environment: "development", worktree: null }, owner],
    ["in production", { environment: "production", worktree: "feature-a" }, owner],
    ["for an invalid owner", own, "../other"],
    ["for an empty owner", own, ""],
  ])("refuses to prepare or remove anything %s", async (_case, layout, name) => {
    await harness.place(`${layout.environment}/kept.png`, "kept");
    const before = await harness.keys();

    await expect(harness.namespace(layout, name).prepare()).rejects.toThrow(/refusing/);
    await expect(harness.namespace(layout, name).remove()).rejects.toThrow(/refusing/);
    expect(await harness.keys()).toEqual(before);
  });
});

describe("the local storage namespace", () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "sebela-namespace-links-"));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  const config = (root: string) => ({
    driver: "local" as const,
    root,
    ...own,
    publicBaseUrl: "https://media.example.test/files",
  });

  it("refuses a prefix folder that is a symbolic link, and leaves its target alone", async () => {
    const outside = join(base, "outside");
    await mkdir(outside);
    await writeFile(join(outside, ".owner"), marker);
    await writeFile(join(outside, "kept.png"), "kept");
    await mkdir(join(base, "root", "development"), { recursive: true });
    await symlink(outside, join(base, "root", "development", "feature-a"));

    await expect(openStorageNamespace(config(join(base, "root")), owner).remove()).rejects.toThrow(
      /not a real folder/,
    );
    await expect(openStorageNamespace(config(join(base, "root")), owner).prepare()).rejects.toThrow(
      /not a real folder/,
    );
    expect(await filesBelow(outside)).toEqual([".owner", "kept.png"]);
  });

  it("refuses a marker that is a symbolic link", async () => {
    const folder = join(base, "root", "development", "feature-a");
    await mkdir(folder, { recursive: true });
    await writeFile(join(base, "elsewhere"), marker);
    await symlink(join(base, "elsewhere"), join(folder, ".owner"));
    await writeFile(join(folder, "kept.png"), "kept");

    await expect(openStorageNamespace(config(join(base, "root")), owner).remove()).rejects.toThrow(
      /refusing/,
    );
    expect(await filesBelow(folder)).toEqual([".owner", "kept.png"]);
  });
});
