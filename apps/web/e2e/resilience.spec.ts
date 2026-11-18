// The assembled site with content absent and dependencies unavailable, across every route: a
// profile without any optional record, a CV PDF whose file cannot be served from any of its entry
// points, images whose originals are gone, a profile that does not exist, and an API that fails,
// stays silent or comes back. Each state gets the same width, theme, keyboard and accessibility
// checks as the happy path. Every block starts its own API and website, so no block shares the
// API's public rate limit with another.
import { readdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { startProxy, type Proxy } from "./proxy";
import { fixtureFolder, startApi, startWebsite, type Fixture, type Started } from "./stack";

// Fixture values (e2e/fixtures/with-sparse-content/): the fictional Jordan Vale with one current
// experience and nothing optional — no photo, email, links, CV PDF, logos, testimonials, projects,
// explorations, current focus, technologies, education or services.
const sparse = { name: "Jordan Vale", role: "Developer · Quietfield Transit" } as const;
// The fictional Casey Morrow of e2e/fixtures/with-experience/, with logos, an author photo and a PDF.
const full = { name: "Casey Morrow" } as const;
const fernwayAlt = "The Fernway Logistics logo: an arrow of three grey lines.";
const rileyAlt = "An illustrated placeholder avatar of the fictional Riley Sample.";

const unavailable = "This page could not be loaded right now.";
const notFound = "This page does not exist yet.";
const contentRoutes = ["/", "/experience", "/services", "/cv", "/ask"] as const;

// The API's end-to-end server keeps its files in the checkout's `.tmp/e2e-storage-*` folders, a
// documented part of its interface (`apps/api/AGENTS.md`, Commands).
const scratch = fileURLToPath(new URL("../../../.tmp", import.meta.url));

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

async function expectTouchTargets(page: Page) {
  const heights = await page
    .locator("main a, main button, footer a")
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.checkVisibility())
        .map((element) => element.getBoundingClientRect().height),
    );
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
}

/** Waits until the page is hydrated, so links navigate on the client and buttons respond. */
async function hydrated(page: Page) {
  await page.waitForFunction(
    () => (window.history.state as { __NA?: boolean } | null)?.__NA === true,
  );
}

/**
 * The keyboard reaches the page: the skip link comes first and moves focus into the content, and
 * every stop after it is visible and shows its focus ring, up to the end of the page.
 */
async function expectKeyboardReachable(page: Page) {
  await hydrated(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  for (let stop = 0; stop < 12; stop += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (element === null || element === document.body) return null;
      const style = getComputedStyle(element);
      return {
        inPage: element.closest("main, footer") !== null,
        visible: element.checkVisibility(),
        ring: style.boxShadow !== "none" || style.outlineStyle !== "none",
        underlined: style.textDecorationLine.includes("underline"),
      };
    });
    // Past the footer's last link the focus leaves the document.
    if (!focused?.inPage) break;
    expect(focused.visible).toBe(true);
    expect(focused.ring || focused.underlined).toBe(true);
  }
}

/** The stored copies of a fixture file in the API's end-to-end storage folders. */
async function storedCopies(fixtureFile: string): Promise<string[]> {
  const expected = await readFile(fixtureFile);
  const found: string[] = [];
  for (const root of await readdir(scratch, { withFileTypes: true })) {
    if (!root.isDirectory() || !root.name.startsWith("e2e-storage-")) continue;
    const folder = join(scratch, root.name);
    for (const entry of await readdir(folder, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      if ((await readFile(path)).equals(expected)) found.push(path);
    }
  }
  return found;
}

/** Moves the stored copies of the fixture's files away; returns how to bring them back. */
async function removeStored(fixture: Fixture, files: readonly string[]) {
  const stored = (
    await Promise.all(
      files.map((file) => storedCopies(join(fixtureFolder(fixture), "files", file))),
    )
  ).flat();
  expect(stored.length).toBeGreaterThanOrEqual(files.length);
  for (const path of stored) await rename(path, `${path}.away`);
  return async () => {
    for (const path of stored) await rename(`${path}.away`, path);
  };
}

/** Starts an API for the fixture and a website reading it for the enclosing block. */
function serve(fixture: Fixture) {
  const started: { api?: Started; website?: Started } = {};
  test.beforeAll(async () => {
    started.api = await startApi(fixture);
    started.website = await startWebsite(started.api.url);
  });
  test.afterAll(async () => {
    await started.website?.stop();
    await started.api?.stop();
  });
  return {
    get url() {
      if (started.website === undefined) throw new Error("The website has not started");
      return started.website.url;
    },
  };
}

/** Screenshots the page at every width in the current scheme, checking it fits each. */
async function shootWidths(page: Page, name: string, scheme: string) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: test.info().outputPath(`${name}-${String(width)}-${scheme}.png`),
      fullPage: true,
    });
  }
}

test.describe("a profile without any optional content", () => {
  const website = serve("with-sparse-content");

  test("the homepage leaves out every optional section and its contact block says what is missing", async ({
    page,
  }) => {
    await page.goto(`${website.url}/`);
    await expect(page.locator("main h2")).toHaveText([
      "What I do",
      "Experience",
      "Have a project or a role in mind?",
    ]);
    // The initials stand in for the photo; no image, and no download without a PDF.
    await expect(page.getByTestId("portrait-fallback")).toBeVisible();
    await expect(page.locator("main img")).toHaveCount(0);
    const snapshot = page.getByRole("region", { name: "Experience", exact: true });
    await expect(snapshot).toContainText("Currently: Developer, Quietfield Transit");
    await expect(snapshot.getByRole("link", { name: "Read the CV" })).toHaveAttribute(
      "href",
      "/cv",
    );
    await expect(snapshot.getByRole("link", { name: "Download CV" })).toHaveCount(0);
    await expect(snapshot.locator("time")).toHaveCount(0);

    // Without an email address or links the block says so instead of standing empty.
    const contact = page.getByRole("region", { name: "Have a project or a role in mind?" });
    await expect(contact).toContainText("No contact details are published yet.");
    await expect(contact.getByRole("link")).toHaveCount(0);

    // Contact in the header still leads to that block.
    await hydrated(page);
    await page.getByRole("banner").getByRole("link", { name: "Contact" }).click();
    await expect(page).toHaveURL(/\/#contact$/u);
    await expect(contact.getByRole("heading")).toBeInViewport();
  });

  test("the experience page shows the career without empty testimonials, R&D, skills or education", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(`${website.url}/experience`);
    expect(response?.status()).toBe(200);
    // The one experience is the only heading: no testimonial, R&D, skills or education section.
    await expect(page.locator("main h2")).toHaveCount(1);
    await expect(page.locator("main h2")).toContainText(sparse.role);
    await expect(page.getByRole("blockquote", { includeHidden: true })).toHaveCount(0);
    await expect(page.locator("main img")).toHaveCount(0);
    const header = page.locator("main header");
    await expect(header.getByRole("link", { name: "Read the CV" })).toHaveAttribute("href", "/cv");
    await expect(header.getByRole("link", { name: "Download CV" })).toHaveCount(0);
    await expect(header).not.toContainText("PDF updated");

    // An anchor to a record that does not exist leaves the page as it is.
    await page.goto("about:blank");
    const unknown = await page.goto(`${website.url}/experience#project-removed-long-ago`);
    expect(unknown?.status()).toBe(200);
    await hydrated(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Experience");
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(errors).toEqual([]);
  });

  test("the services page says none is published yet and still leads to the contact block", async ({
    page,
  }) => {
    await page.goto(`${website.url}/services`);
    await expect(page.locator("main")).toContainText("No services are published yet.");
    await expect(page.locator("main h2")).toHaveText(["Have a project in mind?"]);
    await hydrated(page);
    await page.getByRole("link", { name: "Get in touch" }).click();
    await expect(page).toHaveURL(/\/#contact$/u);
    await expect(
      page.getByRole("heading", { name: "Have a project or a role in mind?" }),
    ).toBeInViewport();
  });

  test("the CV shows what exists and a stale download link leads to it", async ({ page }) => {
    const response = await page.goto(`${website.url}/cv`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(sparse.name);
    await expect(page.locator("main h2")).toHaveText(["Summary", "Experience"]);
    await expect(page.getByRole("list", { name: "Contacts" })).toHaveCount(0);
    await expect(page.locator("main time")).toHaveCount(0);

    const download = await page.request.get(`${website.url}/cv/pdf`, { maxRedirects: 0 });
    expect(download.status()).toBe(303);
    expect(download.headers()["location"]).toBe("/cv");
  });

  test("the Ask page offers its suggestions with the name", async ({ page }) => {
    const response = await page.goto(`${website.url}/ask`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(sparse.name);
    await expect(
      page.getByRole("button", { name: `What is ${sparse.name} working on now?` }),
    ).toBeVisible();
  });
});

test.describe("a profile without any optional content in every width and mode", () => {
  const website = serve("with-sparse-content");

  for (const path of contentRoutes) {
    test(`${path} fits, is accessible and keyboard reachable`, async ({ page }) => {
      for (const scheme of schemes) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width: 1280, height: 900 });
        const response = await page.goto(`${website.url}${path}`);
        expect(response?.status()).toBe(200);
        await expect(page.getByText(unavailable)).toHaveCount(0);
        await expectAccessible(page);
        await shootWidths(page, `sparse${path.replace(/\//gu, "-")}`, scheme);
        await expectTouchTargets(page);
      }
      await expectKeyboardReachable(page);
    });
  }
});

test.describe("a CV PDF whose file cannot be served", () => {
  const website = serve("with-experience");
  let restore: (() => Promise<void>) | undefined;

  test.beforeAll(async () => {
    restore = await removeStored("with-experience", ["cv.pdf"]);
  });

  test.afterAll(async () => {
    await restore?.();
  });

  for (const entry of [
    { from: "the homepage's experience snapshot", path: "/", within: "Experience" },
    { from: "the experience page's header", path: "/experience", within: null },
  ] as const) {
    test(`fails truthfully from ${entry.from}, without a download`, async ({ page }) => {
      const downloads: string[] = [];
      page.on("download", (download) => downloads.push(download.suggestedFilename()));
      await page.goto(`${website.url}${entry.path}`);
      await hydrated(page);
      const area =
        entry.within === null
          ? page.locator("main header")
          : page.getByRole("region", { name: entry.within, exact: true });
      await area.getByRole("link", { name: "Download CV" }).click();
      await expect(page).toHaveURL(/\/cv\/pdf\/unavailable$/u);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "The CV PDF could not be downloaded.",
      );
      await expect(page.locator("main")).toContainText("nothing was downloaded");
      expect(downloads).toEqual([]);

      // Trying again fails the same way while the file is gone; the live CV is one click away.
      await page.getByRole("link", { name: "Try the download again" }).click();
      await expect(page).toHaveURL(/\/cv\/pdf\/unavailable$/u);
      expect(downloads).toEqual([]);
      await page.getByRole("link", { name: "Read the CV" }).click();
      await expect(page).toHaveURL(/\/cv$/u);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(full.name);
    });
  }

  test("a direct request is redirected, never stored, and downloads once the file is back", async ({
    page,
  }) => {
    const failed = await page.request.get(`${website.url}/cv/pdf`, { maxRedirects: 0 });
    expect(failed.status()).toBe(303);
    expect(failed.headers()["location"]).toBe("/cv/pdf/unavailable");
    expect(failed.headers()["cache-control"]).toBe("no-store");

    await restore?.();
    restore = undefined;
    await page.goto(`${website.url}/cv/pdf/unavailable`);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Try the download again" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("casey-morrow-cv.pdf");
  });
});

test.describe("images whose originals are gone", () => {
  const website = serve("with-experience");
  let restore: (() => Promise<void>) | undefined;

  test.beforeAll(async () => {
    // A new API stores the images under new keys, so no optimized copy of them exists yet.
    restore = await removeStored("with-experience", [
      "fernway-logistics.png",
      "open-ledger-kit.png",
      "pinecrest-health.png",
      "avatar-riley.png",
    ]);
  });

  test.afterAll(async () => {
    await restore?.();
  });

  test("leave nothing in their place and the rows aligned, never a broken image", async ({
    page,
  }) => {
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${website.url}/experience`);
      await hydrated(page);
      await expect(page.locator('[data-slot="organization-logo"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="author-photo"]')).toHaveCount(0);
      await expect(page.getByRole("img", { name: fernwayAlt })).toHaveCount(0);
      await expect(page.getByRole("img", { name: rileyAlt })).toHaveCount(0);

      // The testimonial keeps its quote and its author's name.
      const fernway = page.locator('[id="experience-fernway-lead-engineer"]');
      await expect(fernway.getByRole("blockquote")).toContainText("dispatch tools quiet");
      await expect(fernway).toContainText("Riley Sample");

      // A row whose logo is gone lines up like a row that never had one.
      // The title is the trigger's last direct child, as in experience.spec.ts.
      const left = (anchor: string) =>
        page
          .locator(`[id="${anchor}"] h2 > button > span`)
          .last()
          .evaluate((element) => Math.round(element.getBoundingClientRect().left));
      expect(await left("experience-fernway-lead-engineer")).toBe(
        await left("experience-morrow-studio-consultant"),
      );

      await expectAccessible(page);
      await shootWidths(page, "images-gone-experience", scheme);
    }
  });
});

test.describe("a profile that does not exist", () => {
  const website = serve("without-profile");

  for (const path of contentRoutes) {
    test(`${path} is not found rather than unavailable, and not indexed`, async ({ page }) => {
      const response = await page.goto(`${website.url}${path}`);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(notFound);
      await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
        "content",
        /noindex/u,
      );
      await expect(page.getByText(unavailable)).toHaveCount(0);
    });
  }

  test("a stale CV download link is not a download", async ({ page }) => {
    const response = await page.request.get(`${website.url}/cv/pdf`, { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers()["location"]).toBe("/cv");
  });
});

test.describe("an API that fails, stays silent and comes back", () => {
  test.describe.configure({ mode: "serial" });

  let api: Started;
  let proxy: Proxy;
  let website: Started;

  test.beforeAll(async () => {
    api = await startApi("with-experience");
    proxy = await startProxy(api.url);
    // A fresh website: nothing is cached yet, so every page has to read the API.
    website = await startWebsite(proxy.url);
    proxy.mode = "down";
  });

  test.afterAll(async () => {
    await website.stop();
    await proxy.close();
    await api.stop();
  });

  for (const path of contentRoutes) {
    test(`${path} says it is unavailable with a failure status, not indexed`, async ({ page }) => {
      const response = await page.goto(`${website.url}${path}`);
      expect(response?.status()).toBe(500);
      expect(response?.headers()["cache-control"] ?? "").not.toMatch(/s-maxage|public/u);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(unavailable);
      await expect(page).toHaveTitle("Content unavailable");
      await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
        "content",
        /noindex/u,
      );
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
      await expect(page.locator("main")).not.toContainText(full.name);
    });
  }

  test("an unknown address is still not found, not unavailable", async ({ page }) => {
    const response = await page.goto(`${website.url}/missing-page`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(notFound);
  });

  test("the CV download leads to its failure page, not to a file", async ({ page }) => {
    const response = await page.request.get(`${website.url}/cv/pdf`, { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers()["location"]).toBe("/cv/pdf/unavailable");
  });

  test("a silent API ends in the same unavailable state after the website's timeout", async ({
    page,
  }) => {
    proxy.mode = "silent";
    try {
      const response = await page.goto(`${website.url}/services`, { timeout: 20_000 });
      expect(response?.status()).toBe(500);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(unavailable);
    } finally {
      proxy.mode = "down";
    }
  });

  test("the failure states fit every width and mode, accessible and keyboard reachable", async ({
    page,
  }) => {
    for (const path of ["/experience", "/missing-page", "/cv/pdf/unavailable", "/ai-roadmap"]) {
      for (const scheme of schemes) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(`${website.url}${path}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectAccessible(page);
        await expectTouchTargets(page);
        await shootWidths(page, `failure${path.replace(/\//gu, "-")}`, scheme);
      }
      await expectKeyboardReachable(page);
    }
  });

  test("Try again shows each page once the API answers, without a rebuild", async ({ context }) => {
    // Every page fails first: one page's recovery caches content another page reads too.
    proxy.mode = "down";
    const pages = [];
    for (const path of contentRoutes) {
      const page = await context.newPage();
      await page.goto(`${website.url}${path}`);
      await hydrated(page);
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
      pages.push({ path, page });
    }
    proxy.mode = "up";
    for (const { path, page } of pages) {
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(page.getByText(unavailable)).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(full.name);
      // A new request reads the content that is now cached, not the failure.
      const reload = await page.reload();
      expect(reload?.status(), path).toBe(200);
      await page.close();
    }
  });

  test("cached content outlives the next outage instead of the failure coming back", async ({
    page,
  }) => {
    proxy.mode = "down";
    for (const path of contentRoutes) {
      const response = await page.goto(`${website.url}${path}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByText(unavailable)).toHaveCount(0);
    }
  });
});
