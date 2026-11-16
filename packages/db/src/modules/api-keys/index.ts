import { asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { apiKeys } from "./schema.js";

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

const metadata = {
  id: apiKeys.id,
  name: apiKeys.name,
  createdAt: apiKeys.createdAt,
  lastUsedAt: apiKeys.lastUsedAt,
  revokedAt: apiKeys.revokedAt,
};

export function createApiKeyPersistence(db: NodePgDatabase): ApiKeyPersistence {
  return {
    async insertKey(key) {
      const [row] = await db.insert(apiKeys).values(key).returning(metadata);
      if (!row) throw new Error("The API key was not stored");
      return row;
    },
    listKeys() {
      return db.select(metadata).from(apiKeys).orderBy(asc(apiKeys.createdAt), asc(apiKeys.id));
    },
    async findCredential(publicId) {
      const [row] = await db
        .select({ id: apiKeys.id, secretHash: apiKeys.secretHash, revokedAt: apiKeys.revokedAt })
        .from(apiKeys)
        .where(eq(apiKeys.publicId, publicId))
        .limit(1);
      return row ?? null;
    },
    async markUsed(id, at) {
      await db.update(apiKeys).set({ lastUsedAt: at }).where(eq(apiKeys.id, id));
    },
    async revokeKey(id) {
      const [row] = await db
        .update(apiKeys)
        .set({ revokedAt: sql`coalesce(${apiKeys.revokedAt}, clock_timestamp())` })
        .where(eq(apiKeys.id, id))
        .returning(metadata);
      return row ?? null;
    },
  };
}
