import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { ApiKeyMetadata, ApiKeyPersistence } from "@sebela/db";

import { DomainError } from "../../errors.js";

/** What may be shown about a key; never the key or its hash. Times are ISO 8601 strings. */
export interface ApiKeyInfo {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export type KeyVerification = { ok: true; keyId: string } | { ok: false };

/**
 * Named API keys for the private routes.
 *
 * - `createKey`: a new key `sebela_<public id>_<secret>` from 256 random bits. The key is returned
 *   this once; only its SHA-256 hash is stored. `validation_failed` for an empty or overlong name.
 * - `listKeys`: metadata of every key, revoked ones included, oldest first.
 * - `revokeKey`: revokes one key; its next verification fails. `not_found` for an unknown id.
 * - `verifyKey`: hashes the presented value and compares it in constant time. Missing, malformed,
 *   unknown and revoked keys give the same `{ ok: false }`. A success records the time of use.
 */
export interface ApiKeyService {
  createKey(name: string): Promise<{ key: string; metadata: ApiKeyInfo }>;
  listKeys(): Promise<ApiKeyInfo[]>;
  revokeKey(id: string): Promise<ApiKeyInfo>;
  verifyKey(presented: string | undefined): Promise<KeyVerification>;
}

export interface ApiKeyServiceOptions {
  /** The clock for the time of last use. */
  now?: () => Date;
}

const PREFIX = "sebela";
const KEY_FORMAT = /^sebela_([0-9a-f]{16})_[A-Za-z0-9_-]{43}$/;
const ID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 100;
const REFUSED: KeyVerification = { ok: false };

const hash = (key: string) => createHash("sha256").update(key, "utf8").digest("hex");

// Compared against when no stored key matches, so an unknown key costs the same work.
const PLACEHOLDER_HASH = hash(`${PREFIX}_placeholder`);

function toInfo(metadata: ApiKeyMetadata): ApiKeyInfo {
  return {
    id: metadata.id,
    name: metadata.name,
    createdAt: metadata.createdAt.toISOString(),
    lastUsedAt: metadata.lastUsedAt?.toISOString() ?? null,
    revokedAt: metadata.revokedAt?.toISOString() ?? null,
  };
}

function sameHash(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function createApiKeyService(
  persistence: ApiKeyPersistence,
  options: ApiKeyServiceOptions = {},
): ApiKeyService {
  const now = options.now ?? (() => new Date());
  return {
    async createKey(name) {
      const trimmed = name.trim();
      if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) {
        throw new DomainError(
          "validation_failed",
          `A key needs a name of 1 to ${String(MAX_NAME_LENGTH)} characters.`,
        );
      }
      const publicId = randomBytes(8).toString("hex");
      const key = `${PREFIX}_${publicId}_${randomBytes(32).toString("base64url")}`;
      const metadata = await persistence.insertKey({
        name: trimmed,
        publicId,
        secretHash: hash(key),
      });
      return { key, metadata: toInfo(metadata) };
    },
    async listKeys() {
      return (await persistence.listKeys()).map(toInfo);
    },
    async revokeKey(id) {
      const revoked = ID_FORMAT.test(id) ? await persistence.revokeKey(id) : null;
      if (!revoked) throw new DomainError("not_found", "There is no key with this id.");
      return toInfo(revoked);
    },
    async verifyKey(presented) {
      const publicId = presented === undefined ? undefined : KEY_FORMAT.exec(presented)?.[1];
      if (presented === undefined || publicId === undefined) return REFUSED;
      const credential = await persistence.findCredential(publicId);
      const matches = sameHash(hash(presented), credential?.secretHash ?? PLACEHOLDER_HASH);
      if (!credential || !matches || credential.revokedAt !== null) return REFUSED;
      await persistence.markUsed(credential.id, now());
      return { ok: true, keyId: credential.id };
    },
  };
}
