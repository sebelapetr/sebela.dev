import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { randomPassword, scramVerifier } from "./credentials.mjs";

test("a random password is long, URL- and SQL-safe and different every time", () => {
  const passwords = new Set(Array.from({ length: 50 }, () => randomPassword()));

  assert.equal(passwords.size, 50);
  for (const password of passwords) {
    assert.match(password, /^[A-Za-z0-9_-]{43,}$/);
  }
});

test("a SCRAM-SHA-256 verifier has the form Postgres stores", () => {
  const verifier = scramVerifier(randomPassword());

  assert.match(
    verifier,
    /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/,
  );
});

test("a verifier never contains its password and differs for the same password", () => {
  const password = randomPassword();
  const first = scramVerifier(password);
  const second = scramVerifier(password);

  assert.equal(first.includes(password), false);
  assert.notEqual(first, second);
});

// RFC 7677, section 3: user "user", password "pencil". A verifier is correct when its server key
// produces the server signature of that exchange.
test("a verifier matches the SCRAM-SHA-256 example of RFC 7677", () => {
  const salt = Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64");
  const verifier = scramVerifier("pencil", { salt, iterations: 4096 });
  const [, keys] = verifier.split(/\$(?=[^$]*$)/);
  const serverKey = Buffer.from(keys.split(":")[1], "base64");
  const nonce = "rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0";
  const authMessage = [
    "n=user,r=rOprNGfwEbeRWgbNEkqO",
    `r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096`,
    `c=biws,r=${nonce}`,
  ].join(",");

  assert.ok(verifier.startsWith("SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ==$"));
  assert.equal(
    createHmac("sha256", serverKey).update(authMessage).digest("base64"),
    "6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=",
  );
});
