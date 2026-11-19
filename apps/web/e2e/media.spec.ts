import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import {
  fixtureFolder,
  freePort,
  mediaBaseUrl,
  origin,
  required,
  startApi,
  startWebsite,
  type Started,
  type StartedApi,
} from "./stack";

// Fixture values (e2e/fixtures/*): fictional people and placeholder images for these tests only.
// The canonical origin is a placeholder no test resolves; it only has to differ from the address
// the website listens on, so the preview addresses are seen to follow the setting.
const SITE = "https://site.example.test";
const portraitAlt = /grey placeholder portrait/u;
const fernwayAlt = "The Fernway Logistics logo: an arrow of three grey lines.";
const portraitPath = join(fixtureFolder("with-photo"), "files", "portrait.png");
// Each API a test starts keeps its files in a storage folder of its own (`StartedApi.storage`,
// `e2e/stack.ts`), so a test changes only its own server's files while other files run.

const widths = [360, 768, 1280] as const;
const schemes = ["light", "dark"] as const;

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
}

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target) })),
  ).toEqual([]);
}

/** Waits until the image has loaded, then returns the source the browser chose and its size. */
async function chosenSource(image: Locator) {
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0),
    )
    .toBe(true);
  return image.evaluate((element: HTMLImageElement) => ({
    src: element.currentSrc,
    rendered: element.getBoundingClientRect().width,
    natural: element.naturalWidth,
  }));
}

/** The original's address and the requested width of an optimizer address. */
function optimized(src: string): { readonly url: string; readonly width: number } {
  const address = new URL(src);
  expect(address.pathname).toBe("/_next/image");
  return {
    url: address.searchParams.get("url") ?? "",
    width: Number(address.searchParams.get("w")),
  };
}

/** The width and height a PNG states in its header. */
function pngSize(body: Buffer): { readonly width: number; readonly height: number } {
  expect(body.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
}

/** The stored copies of a fixture file in the API's end-to-end storage folders. */
async function storedCopies(storage: string, fixtureFile: string): Promise<string[]> {
  const expected = await readFile(fixtureFile);
  const found: string[] = [];
  for (const entry of await readdir(storage, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    if ((await readFile(path)).equals(expected)) found.push(path);
  }
  return found;
}

/** The optimizer's status for a source address at an allowed width and quality. */
async function optimizerStatus(request: APIRequestContext, base: string, source: string) {
  const response = await request.get(
    `${base}/_next/image?url=${encodeURIComponent(source)}&w=320&q=75`,
    { maxRedirects: 0 },
  );
  return response.status();
}

test.describe("the image optimizer's sources", () => {
  let api: Started;
  let website: Started;
  let portrait: string;

  test.beforeAll(async ({ browser }) => {
    api = await startApi("with-photo");
    website = await startWebsite(api.url);
    const page = await browser.newPage();
    await page.goto(`${website.url}/`);
    portrait = optimized(
      await page.getByRole("img", { name: portraitAlt }).evaluate((image: HTMLImageElement) => {
        return image.currentSrc;
      }),
    ).url;
    await page.close();
  });

  test.afterAll(async () => {
    await website.stop();
    await api.stop();
  });

  test("optimizes a stored image from the site's own media path as WebP", async ({ request }) => {
    expect(portrait).toMatch(/^\/media\/[A-Za-z0-9-]+\.png$/u);
    const response = await request.get(
      `${website.url}/_next/image?url=${encodeURIComponent(portrait)}&w=320&q=75`,
      { headers: { Accept: "image/avif,image/webp,*/*" } },
    );
    expect(response.status()).toBe(200);
    // WebP only, even for a browser that would take AVIF.
    expect(response.headers()["content-type"]).toBe("image/webp");
  });

  test("serves the stored file on the media path as the API stores it", async ({ request }) => {
    const name = portrait.slice("/media/".length);
    const original = await request.get(`${mediaBaseUrl(api.url)}/${name}`);
    const served = await request.get(`${website.url}${portrait}`, { maxRedirects: 0 });
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("image/png");
    expect(served.headers()["x-content-type-options"]).toBe("nosniff");
    expect(served.headers()["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect((await served.body()).equals(await original.body())).toBe(true);
    // The page names only the site's path, never the address the server reads the file from.
    const html = await (await request.get(`${website.url}/`)).text();
    expect(html).not.toContain(mediaBaseUrl(api.url));
  });

  test("answers 404 on the media path for anything but a stored image", async ({ request }) => {
    const name = portrait.slice("/media/".length);
    for (const path of [
      `/media/${name.replace(/\.png$/u, ".pdf")}`,
      `/media/${name.replace(/\.png$/u, ".svg")}`,
      `/media/..%2f..%2fv1%2fperson`,
      `/media/%2e%2e.png`,
      `/media/missing-file.png`,
    ]) {
      const response = await request.get(`${website.url}${path}`, { maxRedirects: 0 });
      expect({ path, status: response.status() }).toEqual({ path, status: 404 });
    }
  });

  test("refuses every other source, width and quality", async ({ request }) => {
    const base = mediaBaseUrl(api.url);
    const name = portrait.slice("/media/".length);
    const host = required("API_HOST");
    const otherPort = origin(host, await freePort(host));
    const refused = [
      // The stored file's own address, another host and the API's own routes.
      `${base}/${name}`,
      `https://images.example.test/${name}`,
      `${api.url}/v1/person`,
      `${otherPort}/media/${name}`,
      `${website.url}/media/${name}`,
      // Another path on the site, traversal written plainly or escaped, a query, a nested folder
      // and a file that is not an image.
      `/v1/media/files/test/${name}`,
      `/media/../favicon.ico`,
      `/media/..%2f..%2fv1%2fperson`,
      `/media/${name}?download=1`,
      `/media/nested/${name}`,
      `/media/${name.replace(/\.[a-z]+$/u, ".pdf")}`,
      "/favicon.ico",
      "/cv/pdf",
      "file:///etc/passwd",
      "http://169.254.169.254/latest/meta-data/",
    ];
    for (const source of refused) {
      expect({ source, status: await optimizerStatus(request, website.url, source) }).toEqual({
        source,
        status: 400,
      });
    }

    for (const query of ["w=4000&q=75", "w=320&q=100", "w=333&q=75"]) {
      const response = await request.get(
        `${website.url}/_next/image?url=${encodeURIComponent(portrait)}&${query}`,
      );
      expect({ query, status: response.status() }).toEqual({ query, status: 400 });
    }
  });

  test("records what the portrait weighs at each width it is served", async ({ request }) => {
    const original = await request.get(`${website.url}${portrait}`);
    expect(original.status()).toBe(200);
    const sizes: Record<string, number> = { original: (await original.body()).length };
    for (const width of [160, 256, 320, 480, 750]) {
      const response = await request.get(
        `${website.url}/_next/image?url=${encodeURIComponent(portrait)}&w=${String(width)}&q=75`,
        { headers: { Accept: "image/webp,*/*" } },
      );
      expect(response.headers()["content-type"]).toBe("image/webp");
      expect(response.status()).toBe(200);
      sizes[`webp-${String(width)}`] = (await response.body()).length;
    }
    await writeFile(test.info().outputPath("portrait-sizes.json"), JSON.stringify(sizes, null, 2));
    console.log("Portrait bytes by served width:", JSON.stringify(sizes));
  });
});

test.describe("responsive sources chosen by the browser", () => {
  test("the portrait asks for no wider source than it is rendered at", async ({ page }) => {
    // The portrait is 160, 224 and 320 CSS px wide at these widths; the smallest configured width
    // that covers it is chosen.
    const expected = { 360: 160, 768: 256, 1280: 320 } as const;
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const source = await chosenSource(page.getByRole("img", { name: portraitAlt }));
      expect(optimized(source.src).width).toBe(expected[width]);
      expect(source.rendered).toBeLessThanOrEqual(optimized(source.src).width);
    }
  });

  test("a sharper screen asks for a source of twice the width", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 360, height: 800 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto(test.info().project.use.baseURL ?? "");
    const source = await chosenSource(page.getByRole("img", { name: portraitAlt }));
    expect(optimized(source.src).width).toBe(320);
    await context.close();
  });

  test("the portrait has its alt text, its dimensions and preloads", async ({ page }) => {
    await page.goto("/");
    const image = page.getByRole("img", { name: portraitAlt });
    await expect(image).toHaveAttribute("width", "480");
    await expect(image).toHaveAttribute("height", "600");
    await expect(page.locator('link[rel="preload"][as="image"]')).toHaveCount(1);
  });
});

test.describe("organization logos through the optimizer", () => {
  let api: Started;
  let website: Started;

  test.beforeAll(async () => {
    api = await startApi("with-experience");
    website = await startWebsite(api.url);
  });

  test.afterAll(async () => {
    await website.stop();
    await api.stop();
  });

  test("a logo asks for the width its own aspect ratio renders at", async ({ page }) => {
    // The Fernway logo is 240 × 64: 90 px wide at 24 px tall and 120 px at 32 px.
    const expected = { 360: 96, 768: 128, 1280: 128 } as const;
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${website.url}/experience`);
      const logo = page.getByRole("img", { name: fernwayAlt });
      const source = await chosenSource(logo);
      expect(optimized(source.src).width).toBe(expected[width]);
      expect(source.rendered).toBeLessThanOrEqual(optimized(source.src).width);
    }
  });
});

test.describe("an original that is gone", () => {
  let api: StartedApi;
  let website: Started;
  let stored: string[] = [];

  test.beforeAll(async () => {
    // A new API stores the portrait under a new key, so no optimized copy of it exists yet.
    api = await startApi("with-photo");
    website = await startWebsite(api.url);
    stored = await storedCopies(api.storage, portraitPath);
    expect(stored.length).toBeGreaterThan(0);
    for (const path of stored) await rename(path, `${path}.away`);
  });

  test.afterAll(async () => {
    for (const path of stored) await rename(`${path}.away`, path);
    await website.stop();
    await api.stop();
  });

  test("leaves the initials in the portrait's place, never a broken image", async ({ page }) => {
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${website.url}/`);
        await expect(page.getByTestId("portrait-fallback")).toBeVisible();
        await expect(page.getByRole("img", { name: portraitAlt })).toHaveCount(0);
        await expect(page.locator("main img")).toHaveCount(0);
        await expectNoHorizontalScroll(page);
        await page.screenshot({
          path: test.info().outputPath(`portrait-gone-${String(width)}-${scheme}.png`),
        });
      }
      await expectAccessible(page);
    }
  });
});

test.describe("optimized images in every width and mode", () => {
  let api: Started;
  let website: Started;

  test.beforeAll(async () => {
    api = await startApi("with-experience");
    website = await startWebsite(api.url);
  });

  test.afterAll(async () => {
    await website.stop();
    await api.stop();
  });

  for (const [name, path, home] of [
    ["homepage", "/", true],
    ["experience", "/experience", false],
  ] as const) {
    test(`the ${name} page with its images`, async ({ page }) => {
      const base = home ? (test.info().project.use.baseURL ?? "") : website.url;
      for (const scheme of schemes) {
        await page.emulateMedia({ colorScheme: scheme });
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${base}${path}`);
          const images = page.locator("main img");
          const count = await images.count();
          expect(count).toBeGreaterThan(0);
          for (let index = 0; index < count; index += 1) {
            const image = images.nth(index);
            await image.scrollIntoViewIfNeeded();
            const source = await chosenSource(image);
            expect(source.src).toContain("/_next/image?url=");
            expect(await image.getAttribute("alt")).not.toBe("");
          }
          await expectNoHorizontalScroll(page);
          await page.screenshot({
            path: test.info().outputPath(`${name}-images-${String(width)}-${scheme}.png`),
          });
        }
        await expectAccessible(page);
      }
    });
  }

  test("images stay out of the keyboard order", async ({ page }) => {
    await page.goto(`${website.url}/experience`);
    for (let step = 0; step < 15; step += 1) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("IMG");
    }
  });
});

test.describe("Open Graph previews", () => {
  let api: Started;
  let website: Started;

  test.beforeAll(async () => {
    api = await startApi("with-experience");
    website = await startWebsite(api.url, { siteOrigin: SITE });
  });

  test.afterAll(async () => {
    await website.stop();
    await api.stop();
  });

  for (const [path, page] of [
    ["/", "home"],
    ["/experience", "experience"],
    ["/services", "services"],
    ["/cv", "cv"],
  ] as const) {
    test(`${path} names its own preview image on the configured origin`, async ({
      page: browser,
      request,
    }) => {
      await browser.goto(`${website.url}${path}`);
      const image = `${SITE}/og/${page}`;
      await expect(browser.locator('meta[property="og:image"]')).toHaveAttribute("content", image);
      await expect(browser.locator('meta[property="og:image:width"]')).toHaveAttribute(
        "content",
        "1200",
      );
      await expect(browser.locator('meta[property="og:image:height"]')).toHaveAttribute(
        "content",
        "630",
      );
      await expect(browser.locator('meta[property="og:image:alt"]')).toHaveAttribute(
        "content",
        await browser.title(),
      );
      await expect(browser.locator('meta[name="twitter:card"]')).toHaveAttribute(
        "content",
        "summary_large_image",
      );
      await expect(browser.locator('meta[name="twitter:image"]')).toHaveAttribute("content", image);

      const response = await request.get(`${website.url}/og/${page}`);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/png");
      expect(response.headers()["cache-control"]).toBe("no-cache");
      const body = await response.body();
      expect(pngSize(body)).toEqual({ width: 1200, height: 630 });
      await writeFile(test.info().outputPath(`og-${page}.png`), body);
      console.log(`Open Graph preview of ${page}: ${String(body.length)} bytes`);
    });
  }

  test("pages without a preview answer 404", async ({ request }) => {
    for (const page of ["ask", "unknown", "toString", "home.png", "ai-roadmap/diary/not-a-date"]) {
      const response = await request.get(`${website.url}/og/${page}`);
      expect({ page, status: response.status() }).toEqual({ page, status: 404 });
    }
  });
});

test.describe("Open Graph previews while the API is down", () => {
  test("still answer with the site's own card, never stored", async ({ request }) => {
    const host = required("API_HOST");
    const website = await startWebsite(origin(host, await freePort(host)), { siteOrigin: SITE });
    try {
      const response = await request.get(`${website.url}/og/experience`);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/png");
      expect(response.headers()["cache-control"]).toBe("no-store");
      const body = await response.body();
      expect(pngSize(body)).toEqual({ width: 1200, height: 630 });
      await writeFile(test.info().outputPath("og-fallback.png"), body);
    } finally {
      await website.stop();
    }
  });
});
