import { randomBytes } from "node:crypto";

import { GetObjectCommand, NoSuchKey, S3Client } from "@aws-sdk/client-s3";
import { afterAll, describe, expect, it } from "vitest";

import {
  type BunnyS3StorageConfig,
  openStorage,
  readStorageConfig,
  type Storage,
} from "./index.js";

/**
 * Opt-in: runs against a real development storage zone only when `STORAGE_BUNNY_INTEGRATION=1`
 * and the `STORAGE_BUNNY_*` variables and an https `STORAGE_PUBLIC_BASE_URL` are set
 * (see docs/testing.md). Everything is written below a fresh `development/integration-<random>/`
 * prefix, and only the keys this run created are deleted.
 */
const enabled = process.env["STORAGE_BUNNY_INTEGRATION"] === "1";

describe.skipIf(!enabled)("bunny-s3 storage against a development zone", () => {
  const worktree = `integration-${randomBytes(6).toString("hex")}`;
  const created = new Set<string>();
  let config: BunnyS3StorageConfig;
  let storage: Storage;

  const open = () => {
    const read = readStorageConfig({
      ...process.env,
      STORAGE_DRIVER: "bunny-s3",
      STORAGE_ENVIRONMENT: "development",
      STORAGE_WORKTREE: worktree,
    });
    if (read.driver !== "bunny-s3") throw new Error("Expected the bunny-s3 driver.");
    config = read;
    storage = openStorage(read).storage;
  };

  /** Reads an object straight from the zone, or `null` when it does not exist. */
  const fetchObject = async (key: string): Promise<Uint8Array | null> => {
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: { accessKeyId: config.zone, secretAccessKey: config.password },
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    try {
      const reply = await client.send(new GetObjectCommand({ Bucket: config.zone, Key: key }));
      return reply.Body === undefined ? null : await reply.Body.transformToByteArray();
    } catch (error) {
      if (error instanceof NoSuchKey) return null;
      throw error;
    } finally {
      client.destroy();
    }
  };

  afterAll(async () => {
    for (const key of created) await storage.delete(key);
  });

  it("stores a file under the worktree prefix and deletes it again", async () => {
    open();
    const bytes = new TextEncoder().encode(`fictional integration file ${worktree}`);

    const key = await storage.store({ bytes, extension: "pdf" });
    created.add(key);

    expect(key).toMatch(new RegExp(`^development/${worktree}/[0-9a-f-]{36}\\.pdf$`));
    expect(storage.publicAddress(key)).toBe(`${config.publicBaseUrl}/${key}`);
    expect(await fetchObject(key)).toEqual(bytes);

    await storage.delete(key);
    expect(await fetchObject(key)).toBeNull();
    await storage.delete(key);
    created.delete(key);
  });

  it("refuses a key outside the worktree prefix without touching the zone", async () => {
    open();
    await expect(
      storage.delete(`development/another-worktree/${crypto.randomUUID()}.pdf`),
    ).rejects.toThrow();
  });
});
