import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/** What may be shown about a key: never the key or its hash. */
export interface ApiKeyMetadata {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/** What verification needs to compare a presented key. */
export interface ApiKeyCredential {
  id: string;
  secretHash: string;
  revokedAt: Date | null;
}

/** Persistence of API keys in their own `auth` schema, apart from content. */
export interface ApiKeyPersistence {
  insertKey(key: { name: string; publicId: string; secretHash: string }): Promise<ApiKeyMetadata>;
  /** Every key, revoked ones included, oldest first. */
  listKeys(): Promise<ApiKeyMetadata[]>;
  findCredential(publicId: string): Promise<ApiKeyCredential | null>;
  markUsed(id: string, at: Date): Promise<void>;
  /** Revokes a key; a revoked key keeps its first revocation time. `null` when there is no key. */
  revokeKey(id: string): Promise<ApiKeyMetadata | null>;
}

export function createApiKeyPersistence(db: NodePgDatabase): ApiKeyPersistence {
  const notImplemented = () => Promise.reject(new Error(`not implemented over ${typeof db}`));
  return {
    insertKey: notImplemented,
    listKeys: notImplemented,
    findCredential: notImplemented,
    markUsed: notImplemented,
    revokeKey: notImplemented,
  };
}
