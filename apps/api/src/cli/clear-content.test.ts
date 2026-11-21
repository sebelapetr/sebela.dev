import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { demoSeedFolder } from "@sebela/services";

import { openTestBackend, type TestBackend } from "../test-support.js";
import { runClearContentCommand } from "./clear-content.js";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    output: { out: (text: string) => out.push(text), err: (text: string) => err.push(text) },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

describe("clear-content command", () => {
  let backend: TestBackend;
  let databaseName: string;

  beforeEach(async () => {
    backend = await openTestBackend();
    databaseName = backend.database.config.name;
    await backend.services.seed.loadSeed(demoSeedFolder);
  });

  afterEach(async () => {
    await backend.close();
  });

  const run = async (args: readonly string[]) => {
    const io = capture();
    const code = await runClearContentCommand(args, backend.services, io.output, databaseName);
    return { code, out: io.out(), err: io.err() };
  };

  it("clears the profile, the roadmap and their media files after the confirmation", async () => {
    expect(await backend.storedFiles()).not.toEqual([]);

    const result = await run(["--confirm", databaseName]);

    expect(result).toMatchObject({ code: 0, err: "" });
    expect(result.out).toMatch(/media: \d+ removed, 0 failed/);
    expect(await backend.services.profile.listOrganizations()).toEqual([]);
    expect((await backend.services.roadmap.getRoadmap()).areas).toEqual([]);
    expect(await backend.services.media.listMedia()).toEqual([]);
    expect(await backend.storedFiles()).toEqual([]);
    expect(await backend.services.seed.loadSeedIntoEmpty(demoSeedFolder)).not.toBeNull();
  });

  it("refuses another database's name and clears nothing", async () => {
    const result = await run(["--confirm", "fictional_other"]);

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/does not match/);
    expect(await backend.services.profile.listOrganizations()).not.toEqual([]);
  });

  for (const args of [[], ["--confirm"], ["--confirm", ""], ["--now"], ["--confirm", "x", "y"]]) {
    it(`prints the usage and clears nothing for ${JSON.stringify(args)}`, async () => {
      const result = await run(args);

      expect(result.code).toBe(2);
      expect(result.err).toMatch(/Usage: clear-content --confirm <database>/);
      expect(await backend.services.profile.listOrganizations()).not.toEqual([]);
    });
  }
});
