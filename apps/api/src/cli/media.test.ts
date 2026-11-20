// The media upload command end to end against the real API app on a temporary database: the file
// is read from disk and sent over the authenticated `POST /v1/media` route, so its bytes never pass
// through a model's tool call (issue #201).
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { samplePdf, samplePng } from "@sebela/services/testing";

import { connection, openTestBackend, type TestBackend } from "../test-support.js";
import { runMediaCommand, type MediaCommandContext } from "./media.js";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    output: { out: (text: string) => out.push(text), err: (text: string) => err.push(text) },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

// The API's address comes from the environment the Vitest configuration loads; the requests never
// leave the process, because the context's fetch hands them to the API app directly.
const apiPort = process.env["API_PORT"] ?? "";
const mediaUrl = `http://api.example.test:${apiPort}/v1/media`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The last printed line: the stored media id, so the owner can copy it alone. */
const lastLine = (text: string) => text.trimEnd().split("\n").at(-1) ?? "";

let backend: TestBackend;
let folder: string;
let key: string;

beforeAll(async () => {
  backend = await openTestBackend();
  ({ key } = await backend.services.apiKeys.createKey("media command"));
  folder = await mkdtemp(join(tmpdir(), "sebela-media-command-"));
  await writeFile(join(folder, "portrait.png"), samplePng({ width: 4, height: 3 }));
  await writeFile(join(folder, "cv.pdf"), samplePdf());
  await writeFile(join(folder, "notes.txt"), "Plain fictional text, not media.\n");
});

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
  await backend.close();
});

let requests: { url: string; authorization: string | null }[];

beforeEach(() => {
  requests = [];
});

/** A context whose fetch reaches the real API app in process and records every request. */
function context(overrides: Partial<MediaCommandContext> = {}): MediaCommandContext {
  return {
    env: {
      SEBELA_ADMIN_API_KEY: key,
      API_HOST: "api.example.test",
      API_PORT: apiPort,
      MEDIA_MAX_BYTES: String(64 * 1024),
      MEDIA_MAX_IMAGE_DIMENSION: "2000",
    },
    cwd: folder,
    fetch: async (input, init) => {
      const url = input;
      requests.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      return backend.api().app.request(url, init, connection());
    },
    ...overrides,
  };
}

describe("media upload", () => {
  it("stores an image over the authenticated route and prints its media id", async () => {
    const io = capture();

    const code = await runMediaCommand(
      ["upload", join(folder, "portrait.png"), "--alt", "A fictional portrait"],
      context(),
      io.output,
    );

    expect(io.err()).toBe("");
    expect(code).toBe(0);
    const id = lastLine(io.out());
    expect(id).toMatch(UUID);
    expect(requests).toEqual([{ url: mediaUrl, authorization: `Bearer ${key}` }]);
    const stored = await backend.services.media.getMedia(id);
    expect(stored).toMatchObject({
      id,
      mediaType: "image/png",
      width: 4,
      height: 3,
      altText: "A fictional portrait",
    });
  });

  it("reads a relative path from the directory the command was started in", async () => {
    const io = capture();

    const code = await runMediaCommand(["upload", "cv.pdf"], context(), io.output);

    expect(code).toBe(0);
    const stored = await backend.services.media.getMedia(lastLine(io.out()));
    expect(stored).toMatchObject({ mediaType: "application/pdf", altText: null });
  });

  it("refuses a missing key before reading or sending anything, naming only the variable", async () => {
    const io = capture();
    const { SEBELA_ADMIN_API_KEY: _omitted, ...env } = context().env;

    const code = await runMediaCommand(["upload", "portrait.png"], context({ env }), io.output);

    expect(_omitted).toBe(key);
    expect(code).toBe(1);
    expect(io.err()).toMatch(/SEBELA_ADMIN_API_KEY/);
    expect(io.out()).toBe("");
    expect(requests).toEqual([]);
  });

  it("refuses a missing API address before sending anything", async () => {
    const io = capture();
    const { API_PORT: _port, ...env } = context().env;

    const code = await runMediaCommand(["upload", "portrait.png"], context({ env }), io.output);

    expect(_port).toBe(apiPort);
    expect(code).toBe(1);
    expect(io.err()).toMatch(/API_PORT/);
    expect(requests).toEqual([]);
  });

  it("refuses a file the route would refuse before sending it", async () => {
    const io = capture();

    const code = await runMediaCommand(["upload", "notes.txt"], context(), io.output);

    expect(code).toBe(1);
    expect(io.err()).toMatch(/unsupported_media_type/);
    expect(requests).toEqual([]);
  });

  it("checks the size against the configured limit before sending", async () => {
    const io = capture();
    const env = { ...context().env, MEDIA_MAX_BYTES: "16" };

    const code = await runMediaCommand(["upload", "portrait.png"], context({ env }), io.output);

    expect(code).toBe(1);
    expect(io.err()).toMatch(/payload_too_large/);
    expect(requests).toEqual([]);
  });

  it("names a file it cannot read", async () => {
    const io = capture();

    const code = await runMediaCommand(["upload", "missing.png"], context(), io.output);

    expect(code).toBe(1);
    expect(io.err()).toMatch(/missing\.png/);
    expect(requests).toEqual([]);
  });

  it("reports the API's refusal without printing the key", async () => {
    const io = capture();
    const wrong = "fictional-wrong-key";
    const env = { ...context().env, SEBELA_ADMIN_API_KEY: wrong };

    const code = await runMediaCommand(["upload", "portrait.png"], context({ env }), io.output);

    expect(code).toBe(1);
    expect(io.err()).toMatch(/401/);
    expect(io.err()).not.toContain(wrong);
    expect(io.out()).toBe("");
  });

  it("names the address it could not reach, never the key", async () => {
    const io = capture();
    const unreachable = context({
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });

    const code = await runMediaCommand(["upload", "portrait.png"], unreachable, io.output);

    expect(code).toBe(1);
    expect(io.err()).toContain(mediaUrl);
    expect(io.err()).not.toContain(key);
  });

  it.each([
    [[]],
    [["upload"]],
    [["upload", "a.png", "b.png"]],
    [["upload", "a.png", "--alt"]],
    [["remove", "a.png"]],
  ])("prints the usage for %j", async (args) => {
    const io = capture();

    const code = await runMediaCommand(args, context(), io.output);

    expect(code).toBe(2);
    expect(io.err()).toMatch(/Usage: media upload <file>/);
    expect(requests).toEqual([]);
  });
});
