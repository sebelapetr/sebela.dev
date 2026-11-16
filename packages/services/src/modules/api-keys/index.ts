import type { ApiKeyPersistence } from "@sebela/db";

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

export function createApiKeyService(
  persistence: ApiKeyPersistence,
  options: ApiKeyServiceOptions = {},
): ApiKeyService {
  const notImplemented = () =>
    Promise.reject(new Error(`not implemented over ${typeof persistence} ${typeof options}`));
  return {
    createKey: notImplemented,
    listKeys: notImplemented,
    revokeKey: notImplemented,
    verifyKey: notImplemented,
  };
}
