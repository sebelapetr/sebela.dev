import { describe, expect, it } from "vitest";

import { readDatabaseConfig } from "./config.js";

// Values come from the environment the test passes in, never from code defaults. The port is the
// documented one (.env.example), loaded by the Vitest configuration; the rest is fictional.
const postgresPort = process.env["POSTGRES_PORT"];
const env = {
  POSTGRES_HOST: "postgres.test",
  POSTGRES_PORT: postgresPort,
  DATABASE_NAME: process.env["DATABASE_NAME"],
  DATABASE_USER: "fictional_role",
  DATABASE_PASSWORD: "fictional-password",
};

describe("readDatabaseConfig", () => {
  it("reads every setting from the environment", () => {
    expect(readDatabaseConfig(env)).toEqual({
      host: "postgres.test",
      port: Number(postgresPort),
      name: env.DATABASE_NAME,
      user: "fictional_role",
      password: "fictional-password",
    });
  });

  it("names every missing or invalid variable without echoing values", () => {
    const attempt = () =>
      readDatabaseConfig({ ...env, DATABASE_PASSWORD: undefined, POSTGRES_PORT: "not-a-port" });

    expect(attempt).toThrow(/DATABASE_PASSWORD/);
    expect(attempt).toThrow(/POSTGRES_PORT/);
    expect(attempt).not.toThrow(/not-a-port/);
  });

  it("refuses an empty value instead of falling back", () => {
    expect(() => readDatabaseConfig({ ...env, DATABASE_USER: "" })).toThrow(/DATABASE_USER/);
  });
});
