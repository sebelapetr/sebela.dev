// The website's cached content recovers without invalidation notifications. The API here sends its
// signed notifications to an address nobody listens on, so every callback is dropped, and the
// website reads the API through a proxy the test can take down. With a fallback interval of five
// seconds, a write shows once the interval has elapsed; a restarted website reads current content
// at once; during an outage cached pages keep their last good content while uncached pages say the
// content is unavailable; and once the API answers again, pages are current without a rebuild.
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
