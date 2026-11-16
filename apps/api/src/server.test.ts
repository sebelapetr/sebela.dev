import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "@sebela/services";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/services/testing";

// Starts the real process: configuration from the environment, port 0 for a free one.
describe("the API process", () => {
  let database: TemporaryDatabase;
  let server: ChildProcess;
  let base: string;
  let output = "";

  beforeAll(async () => {
    // An empty, unmigrated database: starting the API must not migrate it.
    database = await createTemporaryDatabase(readDatabaseConfig(process.env), { migrated: false });
    const { config } = database;
    server = spawn(
      process.execPath,
      ["--import", "tsx", fileURLToPath(new URL("./server.ts", import.meta.url))],
      {
        env: {
          ...process.env,
          API_PORT: "0",
          DATABASE_NAME: config.name,
          DATABASE_USER: config.user,
          DATABASE_PASSWORD: config.password,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    base = await new Promise<string>((resolve, reject) => {
      server.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const address = /listening on (http:\/\/\S+)/.exec(output)?.[1];
        if (address) resolve(address);
      });
      server.once("exit", (code) => {
        reject(new Error(`The API exited with ${String(code)}: ${output}`));
      });
    });
  });

  afterAll(async () => {
    if (server.exitCode === null) {
      server.kill("SIGTERM");
      await once(server, "exit");
    }
    await database.drop();
  });

  it("starts, answers health checks and does not migrate the database", async () => {
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    // The person table does not exist, because start-up never runs migrations.
    const person = await fetch(`${base}/v1/person`);
    expect(person.status).toBe(500);
    expect(await person.json()).toMatchObject({ error: { code: "internal_error" } });
  });

  it("stops cleanly on SIGTERM", async () => {
    server.kill("SIGTERM");
    const [code] = (await once(server, "exit")) as [number | null];

    expect(code).toBe(0);
  });
});
