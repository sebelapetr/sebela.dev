import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBunnyS3Driver, type S3Exchange, type S3Transport } from "./drivers/bunny-s3.js";
import {
  openStorage,
  readStorageConfig,
  type BunnyS3StorageConfig,
  type LocalStorageConfig,
  type Storage,
} from "./index.js";

const environment = {
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_ROOT: "/srv/fictional-storage",
  STORAGE_ENVIRONMENT: "development",
  STORAGE_WORKTREE: "feature-a",
  STORAGE_PUBLIC_BASE_URL: "https://media.example.test/files/",
};

const bunnyEnvironment = {
  STORAGE_DRIVER: "bunny-s3",
  STORAGE_BUNNY_ENDPOINT: "https://de-s3.storage.example.test/",
  STORAGE_BUNNY_REGION: "de",
  STORAGE_BUNNY_ZONE: "fictional-dev-zone",
  STORAGE_BUNNY_PASSWORD: "fictional-zone-password",
  STORAGE_ENVIRONMENT: "development",
  STORAGE_WORKTREE: "feature-a",
  STORAGE_PUBLIC_BASE_URL: "https://cdn.example.test/",
};

const fileName = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|pdf)$/;
const foreignName = "0b8f5c2e-1d4a-4f6b-9c3e-2a7d8e9f0a1b.png";

/** Every file below a folder, as paths relative to it. */
async function filesBelow(folder: string): Promise<string[]> {
  if (!existsSync(folder)) return [];
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
    expect(config).toMatchObject({ root: "/srv/checkout/.tmp/storage" });
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

  it.each([undefined, "", "s3", "LOCAL", "BUNNY-S3"])("refuses the driver %j", (driver) => {
    expect(() => readStorageConfig({ ...environment, STORAGE_DRIVER: driver })).toThrow(
      /STORAGE_DRIVER/,
    );
  });

  describe("bunny-s3", () => {
    it("reads the zone, its credentials and the CDN base without a local root", () => {
      expect(readStorageConfig(bunnyEnvironment)).toEqual({
        driver: "bunny-s3",
        endpoint: "https://de-s3.storage.example.test",
        region: "de",
        zone: "fictional-dev-zone",
        password: "fictional-zone-password",
        environment: "development",
        worktree: "feature-a",
        publicBaseUrl: "https://cdn.example.test",
      });
    });

    it("names every missing or invalid Bunny variable without its value", () => {
      const attempt = () =>
        readStorageConfig({
          ...bunnyEnvironment,
          STORAGE_BUNNY_ENDPOINT: "http://secret-endpoint.example.test",
          STORAGE_BUNNY_REGION: "Secret Region",
          STORAGE_BUNNY_ZONE: "../secret-zone",
          STORAGE_BUNNY_PASSWORD: undefined,
        });
      expect(attempt).toThrow(/STORAGE_BUNNY_ENDPOINT/);
      expect(attempt).toThrow(/STORAGE_BUNNY_REGION/);
      expect(attempt).toThrow(/STORAGE_BUNNY_ZONE/);
      expect(attempt).toThrow(/STORAGE_BUNNY_PASSWORD/);
      expect(attempt).not.toThrow(/secret/);
      expect(attempt).not.toThrow(/STORAGE_LOCAL_ROOT/);
    });

    it.each(["", " ", "secret password", "secret\npassword"])(
      "refuses the password %j without echoing it",
      (password) => {
        const attempt = () =>
          readStorageConfig({ ...bunnyEnvironment, STORAGE_BUNNY_PASSWORD: password });
        expect(attempt).toThrow(/STORAGE_BUNNY_PASSWORD/);
        expect(attempt).not.toThrow(/secret/);
      },
    );

    it.each([
      "https://de-s3.storage.example.test/fictional-dev-zone",
      "https://de-s3.storage.example.test/?x=1",
      "https://user:secret@de-s3.storage.example.test",
      "not a url",
    ])("refuses the endpoint %j that is not a bare https origin", (endpoint) => {
      const attempt = () =>
        readStorageConfig({ ...bunnyEnvironment, STORAGE_BUNNY_ENDPOINT: endpoint });
      expect(attempt).toThrow(/STORAGE_BUNNY_ENDPOINT/);
      expect(attempt).not.toThrow(/secret/);
    });

    it.each([
      "https://de-s3.storage.example.test/fictional-dev-zone",
      "https://fictional-dev-zone.de-s3.storage.example.test",
      "http://cdn.example.test",
    ])("refuses the public base %j that is the storage API or not https", (base) => {
      expect(() =>
        readStorageConfig({ ...bunnyEnvironment, STORAGE_PUBLIC_BASE_URL: base }),
      ).toThrow(/STORAGE_PUBLIC_BASE_URL/);
    });

    it("requires a worktree folder in development, where worktrees share one zone", () => {
      expect(() => readStorageConfig({ ...bunnyEnvironment, STORAGE_WORKTREE: "" })).toThrow(
        /STORAGE_WORKTREE/,
      );
      expect(() =>
        readStorageConfig({ ...bunnyEnvironment, STORAGE_WORKTREE: "../production" }),
      ).toThrow(/STORAGE_WORKTREE/);
    });

    it("needs no worktree folder outside development", () => {
      const config = readStorageConfig({
        ...bunnyEnvironment,
        STORAGE_ENVIRONMENT: "production",
        STORAGE_WORKTREE: "",
      });
      expect(config).toMatchObject({ environment: "production", worktree: null });
    });
  });
});

/** An in-memory, path-style S3 endpoint: the protocol the Bunny driver speaks, without a network. */
function fakeS3(config: BunnyS3StorageConfig) {
  const objects = new Map<string, { body: Uint8Array; headers: Record<string, string> }>();
  const exchanges: S3Exchange[] = [];
  const state = { failWith: null as number | null };
  const error = (status: number, code: string) => ({
    status,
    headers: { "content-type": "application/xml" },
    body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message><RequestId>fictional</RequestId></Error>`,
  });

  const transport: S3Transport = (exchange) => {
    exchanges.push(exchange);
    const url = new URL(exchange.url);
    const signed = exchange.headers["authorization"] ?? "";
    if (url.origin !== config.endpoint) return Promise.resolve(error(400, "InvalidRequest"));
    if (!signed.startsWith(`AWS4-HMAC-SHA256 Credential=${config.zone}/`)) {
      return Promise.resolve(error(403, "InvalidAccessKeyId"));
    }
    if (state.failWith !== null) return Promise.resolve(error(state.failWith, "AccessDenied"));
    const [, bucket, ...path] = url.pathname.split("/");
    if (bucket !== config.zone) return Promise.resolve(error(404, "NoSuchBucket"));
    const key = path.map(decodeURIComponent).join("/");
    if (exchange.method === "PUT") {
      objects.set(key, { body: new Uint8Array(exchange.body), headers: { ...exchange.headers } });
      return Promise.resolve({ status: 200, headers: { etag: '"fictional"' } });
    }
    if (exchange.method === "DELETE") {
      objects.delete(key);
      return Promise.resolve({ status: 204 });
    }
    return Promise.resolve(error(501, "NotImplemented"));
  };

  return { objects, exchanges, state, transport };
}

interface Layout {
  readonly environment: string;
  readonly worktree: string | null;
}

/** One driver under test: its storage and a view of what it holds, outside its interface. */
interface DriverHarness {
  open(layout?: Layout): Storage;
  /** The bytes stored under a key, or `null`. */
  contents(key: string): Promise<Uint8Array | null>;
  /** Every stored key. */
  keys(): Promise<string[]>;
  /** Places a file directly, as another environment or worktree would have stored it. */
  seed(key: string, bytes: Uint8Array): Promise<void>;
  cleanup(): Promise<void>;
}

const defaultLayout: Layout = { environment: "development", worktree: "feature-a" };

async function localHarness(): Promise<DriverHarness> {
  const base = await mkdtemp(join(tmpdir(), "sebela-storage-"));
  const root = join(base, "root");
  return {
    open: (layout = defaultLayout) =>
      openStorage({
        driver: "local",
        root,
        ...layout,
        publicBaseUrl: "https://media.example.test/files",
      }).storage,
    async contents(key) {
      const path = join(root, key);
      return existsSync(path) ? new Uint8Array(await readFile(path)) : null;
    },
    keys: () => filesBelow(root),
    async seed(key, bytes) {
      await mkdir(dirname(join(root, key)), { recursive: true });
      await writeFile(join(root, key), bytes);
    },
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

const bunnyConfig = (layout: Layout = defaultLayout): BunnyS3StorageConfig => ({
  driver: "bunny-s3",
  endpoint: "https://de-s3.storage.example.test",
  region: "de",
  zone: "fictional-dev-zone",
  password: "fictional-zone-password",
  ...layout,
  publicBaseUrl: "https://media.example.test/files",
});

function bunnyHarness(): Promise<DriverHarness> {
  const fake = fakeS3(bunnyConfig());
  return Promise.resolve({
    open: (layout) => createBunnyS3Driver(bunnyConfig(layout), fake.transport),
    contents: (key) => Promise.resolve(fake.objects.get(key)?.body ?? null),
    keys: () => Promise.resolve([...fake.objects.keys()].sort()),
    seed(key, bytes) {
      fake.objects.set(key, { body: bytes, headers: {} });
      return Promise.resolve();
    },
    cleanup: () => Promise.resolve(),
  });
}

describe.each([
  ["local", localHarness],
  ["bunny-s3", bunnyHarness],
])("the %s driver contract", (_name, create) => {
  let harness: DriverHarness;

  beforeEach(async () => {
    harness = await create();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it("stores a file under the environment and worktree prefix with a generated name", async () => {
    const storage = harness.open();

    const key = await storage.store({ bytes: Buffer.from("first"), extension: "png" });

    const [environmentFolder, worktreeFolder, name] = key.split("/");
    expect([environmentFolder, worktreeFolder]).toEqual(["development", "feature-a"]);
    expect(name).toMatch(fileName);
    expect(await harness.contents(key)).toEqual(new Uint8Array(Buffer.from("first")));
    expect(storage.publicAddress(key)).toBe(`https://media.example.test/files/${key}`);
  });

  it("stores directly under the environment without a worktree", async () => {
    const storage = harness.open({ environment: "production", worktree: null });

    const key = await storage.store({ bytes: Buffer.from("%PDF"), extension: "pdf" });

    expect(key).toMatch(/^production\/[^/]+\.pdf$/);
    expect(key.split("/")[1]).toMatch(fileName);
  });

  it("never reuses a key, even for the same content", async () => {
    const storage = harness.open();
    const bytes = Buffer.from("same");

    const keys = await Promise.all([1, 2, 3].map(() => storage.store({ bytes, extension: "png" })));

    expect(new Set(keys).size).toBe(3);
    expect(await harness.keys()).toEqual([...keys].sort());
  });

  it("deletes a file once and treats a missing file as deleted", async () => {
    const storage = harness.open();
    const key = await storage.store({ bytes: Buffer.from("x"), extension: "png" });

    await storage.delete(key);
    await storage.delete(key);

    expect(await harness.contents(key)).toBeNull();
    expect(await harness.keys()).toEqual([]);
  });

  it.each([
    "../outside/decoy.png",
    "development/feature-a/../../../outside/decoy.png",
    "/etc/hostname",
    `development/other-worktree/${foreignName}`,
    `production/feature-a/${foreignName}`,
    `development/${foreignName}`,
    `development/feature-a/nested/${foreignName}`,
    "development/feature-a/decoy.png",
    "development/feature-a/0b8f5c2e-1d4a-4f6b-9c3e-2a7d8e9f0a1b.svg",
    `development/feature-a/${foreignName}/`,
    `development\\feature-a\\${foreignName}`,
    `development/feature-a/${foreignName}\0.txt`,
    "",
  ])("refuses the key %j outside its prefix or layout and leaves it alone", async (key) => {
    const storage = harness.open();
    const foreign = [
      `development/other-worktree/${foreignName}`,
      `production/feature-a/${foreignName}`,
      `development/${foreignName}`,
    ];
    for (const other of foreign) await harness.seed(other, Buffer.from("other"));

    await expect(storage.delete(key)).rejects.toThrow(/key/i);
    expect(storage.publicAddress(key)).toBeNull();

    expect(await harness.keys()).toEqual([...foreign].sort());
  });

  it("refuses to store an extension outside the allowlist", async () => {
    const storage = harness.open();

    await expect(
      storage.store({ bytes: Buffer.from("x"), extension: "svg" as "png" }),
    ).rejects.toThrow(/extension/i);
    expect(await harness.keys()).toEqual([]);
  });
});

describe("local storage", () => {
  let base: string;
  let root: string;
  let outside: string;
  let config: LocalStorageConfig;

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

  it("serves its own files to the API", async () => {
    const { storage, files } = openStorage(config);

    const key = await storage.store({ bytes: Buffer.from("first"), extension: "png" });

    await expect(files?.read(key)).resolves.toEqual(Buffer.from("first"));
    await storage.delete(key);
    await expect(files?.read(key)).resolves.toBeNull();
  });

  it.each([
    "../outside/decoy.png",
    "development/feature-a/../../../outside/decoy.png",
    "/etc/hostname",
    `development/other-worktree/${foreignName}`,
  ])("neither reads nor touches %j outside the root or prefix", async (key) => {
    const { storage, files } = openStorage(config);
    await storage.store({ bytes: Buffer.from("x"), extension: "png" });

    await expect(files?.read(key)).resolves.toBeNull();
    await expect(storage.delete(key)).rejects.toThrow(/key/i);
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
});

describe("bunny-s3 storage", () => {
  let fake: ReturnType<typeof fakeS3>;
  let storage: Storage;

  beforeEach(() => {
    fake = fakeS3(bunnyConfig());
    storage = createBunnyS3Driver(bunnyConfig(), fake.transport);
  });

  const sent = () => fake.exchanges.map(({ method, url }) => `${method} ${url}`);
  const mentionsPassword = (exchange: S3Exchange) =>
    [exchange.url, ...Object.values(exchange.headers), Buffer.from(exchange.body).toString()].some(
      (part) => part.includes("fictional-zone-password"),
    );

  it("writes into the zone, signed for the zone and region, never sending the password", async () => {
    const key = await storage.store({ bytes: Buffer.from("first"), extension: "png" });

    expect(sent()).toEqual([`PUT https://de-s3.storage.example.test/fictional-dev-zone/${key}`]);
    const [exchange] = fake.exchanges;
    expect(exchange?.headers["authorization"]).toMatch(
      /^AWS4-HMAC-SHA256 Credential=fictional-dev-zone\/\d{8}\/de\/s3\/aws4_request,/,
    );
    expect(fake.exchanges.some(mentionsPassword)).toBe(false);
  });

  it("sends the proven content type and a SHA-256 checksum the zone verifies", async () => {
    const bytes = Buffer.from("%PDF-1.7 fictional");

    const key = await storage.store({ bytes, extension: "pdf" });

    const headers = fake.objects.get(key)?.headers ?? {};
    expect(headers["content-type"]).toBe("application/pdf");
    expect(headers["x-amz-checksum-sha256"]).toBe(
      createHash("sha256").update(bytes).digest("base64"),
    );
    expect(Object.keys(headers).filter((name) => /^x-amz-checksum-(?!sha256)/.test(name))).toEqual(
      [],
    );
  });

  it.each([
    ["png", "image/png"],
    ["jpg", "image/jpeg"],
    ["webp", "image/webp"],
  ] as const)("labels a %s file %s", async (extension, type) => {
    const key = await storage.store({ bytes: Buffer.from("x"), extension });

    expect(fake.objects.get(key)?.headers["content-type"]).toBe(type);
  });

  it("deletes only the given key inside the zone", async () => {
    const key = await storage.store({ bytes: Buffer.from("x"), extension: "png" });

    await storage.delete(key);

    expect(sent()).toEqual([
      `PUT https://de-s3.storage.example.test/fictional-dev-zone/${key}`,
      `DELETE https://de-s3.storage.example.test/fictional-dev-zone/${key}`,
    ]);
  });

  it("sends nothing for a refused key", async () => {
    await expect(storage.delete(`development/other-worktree/${foreignName}`)).rejects.toThrow(
      /key/i,
    );

    expect(fake.exchanges).toEqual([]);
  });

  it("turns a refused write into a storage error without the password or SDK details", async () => {
    fake.state.failWith = 403;

    const error: unknown = await storage.store({ bytes: Buffer.from("x"), extension: "png" }).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(Error);
    expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
    expect(Object.keys(error as object)).toEqual([]);
    expect(String(error)).toMatch(/store/i);
    expect(String(error)).toMatch(/403/);
    expect(String(error)).not.toMatch(/fictional-zone-password/);
    expect(fake.objects.size).toBe(0);
  });

  it("turns a refused delete into a storage error", async () => {
    const key = await storage.store({ bytes: Buffer.from("x"), extension: "png" });
    fake.state.failWith = 403;

    await expect(storage.delete(key)).rejects.toThrow(/delete.*403/i);
  });

  it("gives public addresses on the CDN base, never on the storage endpoint", async () => {
    const key = await storage.store({ bytes: Buffer.from("x"), extension: "png" });

    expect(storage.publicAddress(key)).toBe(`https://media.example.test/files/${key}`);
  });

  it("is opened without files for the API to serve and without network access", () => {
    const opened = openStorage(bunnyConfig());

    expect(opened.files).toBeNull();
    expect(opened.storage.publicAddress(`development/feature-a/${foreignName}`)).toBe(
      `https://media.example.test/files/development/feature-a/${foreignName}`,
    );
  });
});
