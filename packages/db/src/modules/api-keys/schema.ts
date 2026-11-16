import { pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const authSchema = pgSchema("auth");

/** Named API keys. Only a hash of the secret is stored; the key itself is shown once, at creation. */
export const apiKeys = authSchema.table("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  publicId: text("public_id").notNull().unique(),
  secretHash: text("secret_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
