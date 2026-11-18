// The website's cached content follows committed content writes: the API signs a notification to
// `POST /internal/invalidation` after each write, and the next rendered request shows current
// data within ten seconds. A second website on the same API without the receiver keeps serving its
// cached copy, which shows that the first one is not merely uncached.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { freePort, origin, required, startApi, startWebsite, type Started } from "./stack";

const scratch = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
const within = { timeout: 10_000, intervals: [250] };

test.describe.configure({ mode: "serial" });

test.describe("cached content after signed invalidations", () => {
  let api: Started;
  let website: Started;
  let uncached: Started;
  let key: string;
  let keyFile: string;

  test.beforeAll(async () => {
    // A disposable secret for this run only.
    const secret = randomBytes(32).toString("hex");
    await mkdir(scratch, { recursive: true });
    keyFile = `${scratch}e2e-api-key-${randomBytes(6).toString("hex")}`;
    const webPort = await freePort(required("WEB_HOST"));
    api = await startApi("with-experience", {
      invalidation: {
        url: `${origin(required("WEB_HOST"), webPort)}/internal/invalidation`,
        secret,
      },
      keyFile,
    });
    key = (await readFile(keyFile, "utf8")).trim();
    website = await startWebsite(api.url, { port: webPort, invalidationSecret: secret });
    uncached = await startWebsite(api.url);
  });

  test.afterAll(async () => {
    await uncached.stop();
    await website.stop();
    await api.stop();
    await rm(keyFile, { force: true });
  });

  async function write(method: "PATCH" | "DELETE", path: string, body?: unknown) {
    const response = await fetch(`${api.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.ok, `${method} ${path} answers ${String(response.status)}`).toBe(true);
  }

  async function text(base: string, path: string): Promise<string> {
    const response = await fetch(`${base}${path}`);
    return response.text();
  }

  async function status(base: string, path: string): Promise<number> {
    const response = await fetch(`${base}${path}`);
    await response.arrayBuffer();
    return response.status;
  }

  async function bytes(base: string, path: string): Promise<string> {
    const response = await fetch(`${base}${path}`);
    return Buffer.from(await response.arrayBuffer()).toString("base64");
  }

  test("an update reaches the homepage, its metadata, llms.txt and the preview image", async () => {
    const before = "Fictional engineer who builds calm software for logistics and health care";
    const after = "Fictional engineer who now builds quiet software for small libraries";
    for (const base of [website.url, uncached.url]) {
      expect(await text(base, "/")).toContain(before);
      expect(await text(base, "/llms.txt")).toContain(before);
    }
    const preview = await bytes(website.url, "/og/home");

    await write("PATCH", "/v1/person", { headline: after });

    await expect.poll(() => text(website.url, "/"), within).toContain(after);
    const homepage = await text(website.url, "/");
    expect(homepage).not.toContain(before);
    // The title and the description of the homepage name the headline.
    expect(homepage).toContain(`<title>Casey Morrow — ${after}</title>`);
    expect(await text(website.url, "/llms.txt")).toContain(after);
    expect(await bytes(website.url, "/og/home")).not.toBe(preview);

    // Without the receiver the cached copy is still served: the edit arrived by invalidation.
    expect(await text(uncached.url, "/")).toContain(before);
    expect(await text(uncached.url, "/llms.txt")).toContain(before);
  });

  test("a relation change leaves the former evidence and shows the new one", async () => {
    const services = await text(website.url, "/services");
    expect(services).toContain("Clinic scheduling");
    expect(services).not.toContain("Records export");
    const experience = await text(website.url, "/experience");
    expect(experience).toContain("Clinic scheduling");

    await write("PATCH", "/v1/services/process-automation", {
      evidence: [{ kind: "project", project: "records-export" }],
    });

    await expect.poll(() => text(website.url, "/services"), within).toContain("Records export");
    expect(await text(website.url, "/services")).not.toContain("Clinic scheduling");
    expect(await text(uncached.url, "/services")).toContain("Clinic scheduling");
  });

  test("a deletion removes the record from the pages that showed it", async () => {
    expect(await text(website.url, "/services")).toContain("Custom software");
    expect(await text(website.url, "/llms.txt")).toContain("Custom software");

    await write("DELETE", "/v1/services/custom-software");

    await expect
      .poll(() => text(website.url, "/services"), within)
      .not.toContain("Custom software");
    expect(await text(website.url, "/llms.txt")).not.toContain("Custom software");
    expect(await text(uncached.url, "/services")).toContain("Custom software");
  });

  test("deleting the person takes down the pages, the sitemap and llms.txt", async () => {
    for (const path of ["/", "/cv", "/sitemap.xml", "/llms.txt"]) {
      expect(await status(website.url, path)).toBe(200);
    }

    await write("DELETE", "/v1/person");

    await expect.poll(() => status(website.url, "/sitemap.xml"), within).toBe(404);
    expect(await status(website.url, "/llms.txt")).toBe(404);
    expect(await status(website.url, "/")).toBe(404);
    expect(await status(uncached.url, "/sitemap.xml")).toBe(200);
  });
});
