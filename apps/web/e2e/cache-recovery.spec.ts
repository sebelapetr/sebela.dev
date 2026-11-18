// The website's cached content recovers without invalidation notifications. The API here sends its
// signed notifications to an address nobody listens on, so every callback is dropped, and the
// website reads the API through a proxy the test can take down. With a fallback interval of five
// seconds, a write to the profile, the roadmap or the learning diary shows once the interval has elapsed, on the
// overview, an area's page and the homepage's Exploring alike, and a moved or deleted module
// leaves its old address; a restarted website reads current content at once; during an outage cached pages keep their last
// good content while uncached pages say the content is unavailable; and once the API answers
// again, pages are current without a rebuild.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { startProxy, type Proxy } from "./proxy";
import { freePort, origin, required, startApi, startWebsite, type Started } from "./stack";

const scratch = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
const revalidateSeconds = 5;
const unavailable = "This page could not be loaded right now.";

test.describe.configure({ mode: "serial" });

test.describe("cached content without invalidation notifications", () => {
  let api: Started;
  let proxy: Proxy;
  let website: Started;
  let webPort: number;
  let key: string;
  let keyFile: string;

  test.beforeAll(async () => {
    // A disposable secret for this run only; nothing listens at the receiver's address.
    const secret = randomBytes(32).toString("hex");
    await mkdir(scratch, { recursive: true });
    keyFile = `${scratch}e2e-api-key-${randomBytes(6).toString("hex")}`;
    const host = required("WEB_HOST");
    const nobody = await freePort(host);
    api = await startApi("with-experience", {
      invalidation: { url: `${origin(host, nobody)}/internal/invalidation`, secret },
      keyFile,
    });
    key = (await readFile(keyFile, "utf8")).trim();
    proxy = await startProxy(api.url);
    webPort = await freePort(host);
    website = await startWebsite(proxy.url, {
      port: webPort,
      contentRevalidateSeconds: revalidateSeconds,
    });
  });

  test.afterAll(async () => {
    await website.stop();
    await proxy.close();
    await api.stop();
    await rm(keyFile, { force: true });
  });

  async function setHeadline(headline: string) {
    const response = await fetch(`${api.url}/v1/person`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ headline }),
    });
    // The write succeeds although its notification cannot be delivered.
    expect(response.status, "PATCH /v1/person").toBe(200);
  }

  async function read(path: string): Promise<{ status: number; body: string }> {
    const response = await fetch(`${website.url}${path}`);
    return { status: response.status, body: await response.text() };
  }

  test("a dropped notification shows the write once the fallback interval has elapsed", async () => {
    const before = "Fictional engineer who builds calm software for logistics and health care";
    const after = "Fictional engineer who now repairs bicycles in a small town";
    expect((await read("/")).body).toContain(before);

    await setHeadline(after);

    // Inside the interval the cached copy is still served: no notification arrived.
    expect((await read("/")).body).toContain(before);
    await expect
      .poll(async () => (await read("/")).body, {
        timeout: (revalidateSeconds + 5) * 1_000,
        intervals: [500],
      })
      .toContain(after);
  });

  test("a roadmap write with a dropped notification shows once the fallback interval has elapsed", async () => {
    // This fixture has no roadmap: the warmed overview says so until the new area shows.
    const empty = "No roadmap areas are published yet.";
    expect((await read("/ai-roadmap")).body).toContain(empty);

    const response = await fetch(`${api.url}/v1/roadmap/areas`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "late-orbits", name: "Late orbits", weight: 20, position: 0 }),
    });
    // The write succeeds although its notification cannot be delivered.
    expect(response.status, "POST /v1/roadmap/areas").toBe(201);

    // Inside the interval the cached copy is still served: no notification arrived.
    expect((await read("/ai-roadmap")).body).toContain(empty);
    await expect
      .poll(async () => (await read("/ai-roadmap")).body, {
        timeout: (revalidateSeconds + 5) * 1_000,
        intervals: [500],
      })
      .toContain("Late orbits");
  });

  test("a diary write with a dropped notification shows once the fallback interval has elapsed", async () => {
    // This fixture has no diary: the warmed list says so and the day does not exist yet.
    const empty = "No diary entries yet.";
    const day = "/ai-roadmap/diary/2026-03-05";
    expect((await read("/ai-roadmap/diary")).body).toContain(empty);
    expect((await read(day)).status).toBe(404);

    const response = await fetch(`${api.url}/v1/roadmap/diary/2026-03-05`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "Fictional notes about late orbits." }),
    });
    // The write succeeds although its notification cannot be delivered.
    expect(response.status, "PATCH /v1/roadmap/diary/2026-03-05").toBe(200);

    // Inside the interval the cached list is still served: no notification arrived.
    expect((await read("/ai-roadmap/diary")).body).toContain(empty);
    const within = { timeout: (revalidateSeconds + 5) * 1_000, intervals: [500] };
    await expect
      .poll(async () => (await read("/ai-roadmap/diary")).body, within)
      .toContain("Fictional notes about late orbits.");
    await expect.poll(async () => (await read(day)).status, within).toBe(200);
  });

  test("a new module and resource reach the warmed area page and homepage Exploring after the interval", async () => {
    async function create(path: string, body: unknown) {
      const response = await fetch(`${api.url}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status, `POST ${path}`).toBe(201);
    }

    // Warm the area page and the homepage: the area has no modules, and nothing is in progress.
    expect((await read("/ai-roadmap/late-orbits")).body).toContain("No modules yet.");
    expect((await read("/")).body).not.toContain("Exploring");

    await create("/v1/roadmap/modules", {
      slug: "slow-drift",
      area: "late-orbits",
      name: "Slow drift",
      position: 0,
    });
    await create("/v1/roadmap/resources", {
      slug: "drift-notes",
      module: "slow-drift",
      name: "Fictional drift notes",
      type: "link",
      status: "in-progress",
      position: 0,
    });

    const fallback = { timeout: (revalidateSeconds + 5) * 1_000, intervals: [500] };
    await expect
      .poll(async () => (await read("/ai-roadmap/late-orbits")).body, fallback)
      .toContain("Slow drift");
    // The module's own page was never cached, so it is current at once.
    expect((await read("/ai-roadmap/late-orbits/slow-drift")).body).toContain(
      "Fictional drift notes",
    );
    await expect
      .poll(async () => (await read("/")).body, fallback)
      .toMatch(/Exploring[\s\S]*Late orbits[\s\S]*Slow drift/u);
  });

  test("a moved and then deleted module leaves its warmed old address after the interval", async () => {
    async function write(method: string, path: string, body?: unknown) {
      const response = await fetch(`${api.url}${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect(response.ok, `${method} ${path}`).toBe(true);
    }
    const old = "/ai-roadmap/late-orbits/slow-drift";
    const moved = "/ai-roadmap/far-orbits/slow-drift";
    await write("POST", "/v1/roadmap/areas", {
      slug: "far-orbits",
      name: "Far orbits",
      weight: 10,
      position: 1,
    });
    // Warm the old address and the new one, which does not exist yet.
    expect((await read(old)).status).toBe(200);
    expect((await read(moved)).status).toBe(404);

    await write("PATCH", "/v1/roadmap/modules/slow-drift", { area: "far-orbits" });
    const fallback = { timeout: (revalidateSeconds + 5) * 1_000, intervals: [500] };
    await expect.poll(async () => (await read(old)).status, fallback).toBe(404);
    await expect.poll(async () => (await read(moved)).status, fallback).toBe(200);

    // A module with resources cannot be deleted: its resource goes first.
    await write("DELETE", "/v1/roadmap/resources/drift-notes");
    await write("DELETE", "/v1/roadmap/modules/slow-drift");
    await expect.poll(async () => (await read(moved)).status, fallback).toBe(404);
  });

  test("a restarted website reads current content at once", async () => {
    const headline = "Fictional engineer who restarted the website";
    expect((await read("/")).body).not.toContain(headline);
    await setHeadline(headline);

    await website.stop();
    website = await startWebsite(proxy.url, {
      port: webPort,
      contentRevalidateSeconds: revalidateSeconds,
    });

    expect((await read("/")).body).toContain(headline);
  });

  test("an outage keeps cached content, and the next request after it is current", async ({
    page,
  }) => {
    const cached = "Fictional engineer who restarted the website";
    const recovered = "Fictional engineer who came back after the outage";
    expect((await read("/")).body).toContain(cached);

    proxy.mode = "down";
    await new Promise((resolve) => setTimeout(resolve, (revalidateSeconds + 1) * 1_000));

    // The expired copy is served instead of an error or an empty page.
    const during = await page.goto(website.url);
    expect(during?.status()).toBe(200);
    await expect(page.getByText(cached).first()).toBeVisible();
    await expect(page.getByText(unavailable)).toHaveCount(0);
    // The CV reads a route the homepage does not: this website has nothing to fall back on.
    const uncached = await page.goto(`${website.url}/cv`);
    expect(uncached?.status()).toBe(500);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(unavailable);

    proxy.mode = "up";
    await setHeadline(recovered);

    // No rebuild and no notification: the expired copy is read again on the next request.
    expect((await read("/")).body).toContain(recovered);
    const after = await page.goto(`${website.url}/cv`);
    expect(after?.status()).toBe(200);
    await expect(page.getByText(unavailable)).toHaveCount(0);
  });
});
