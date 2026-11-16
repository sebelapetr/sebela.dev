// Credentials of the worktree database roles — see docs/repository-structure.md ("Worktree
// databases"). Pure functions on node:crypto, no database.
//
// The password goes only into the worktree's environment file. Postgres receives a SCRAM-SHA-256
// verifier instead, which it stores as given: the password itself never appears in a statement,
// so it cannot reach a command line, an error message or the server log.

import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

const PASSWORD_BYTES = 32;
const SALT_BYTES = 16;
// The iteration count Postgres uses for the verifiers it computes itself.
const ITERATIONS = 4096;

// 256 random bits as base64url: no quotes, spaces or `$`, so it is safe in an environment file, a
// connection URL and SQL.
export function randomPassword() {
  return randomBytes(PASSWORD_BYTES).toString("base64url");
}

// The SCRAM-SHA-256 verifier of RFC 5802 and 7677 in Postgres's stored form:
// `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>`. The password is used as given; that
// equals its SASLprep normalisation for the ASCII passwords randomPassword produces.
export function scramVerifier(
  password,
  { salt = randomBytes(SALT_BYTES), iterations = ITERATIONS } = {},
) {
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest("base64");
  const serverKey = createHmac("sha256", salted).update("Server Key").digest("base64");
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey}:${serverKey}`;
}
