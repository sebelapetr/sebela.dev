// The bookshelf against the fictional shelf of e2e/fixtures/with-bookshelf/ (Robin Ashby, the
// with-diary tree and diary): a completed book with a cover, every optional fact, a Markdown summary
// that tries to inject markup and a word that cannot break at a space, read through the resource
// "signal-book" with one hour logged across Prague midnight; a book being read without a cover or
// resource; and a book to read with nothing but its title. It covers the shelf's order, statuses and
// covers, a book's facts, progress, reading time and summary, the way from a resource and a diary
// session to the book and back, titles, structured data and preview images, a missing book, safe
// rendering, the keyboard, widths, themes, axe and touch targets, book, resource-link and time
// writes reaching the warmed shelf, the book pages (the former book of a moved link included) and
// the module page through the signed invalidation, the empty shelf of the main stack and the
// unavailable state.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freePort, origin, required, startApi, startWebsite, type Started } from "./stack";

const scratch = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
const within = { timeout: 10_000, intervals: [250] };

const name = "Robin Ashby";
const unavailable = "This page could not be loaded right now.";
const widths = [360, 768, 1280] as const;
const schemes = ["light", "dark"] as const;

const shelf = "/ai-roadmap/bookshelf";
const completedBook = `${shelf}/quiet-orbit-handbook`;
const readingBook = `${shelf}/drifting-signals`;
const bareBook = `${shelf}/bare-volume`;
const modulePage = "/ai-roadmap/orbit-foundations/signal-basics";
const diaryDay = "/ai-roadmap/diary/2026-03-02";

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

// Every visible link of the sub-navigation and the content is at least 44 px tall
// (docs/design.md, Components); links inside running text, a summary's list items included, are not.
async function expectTouchTargets(page: Page) {
  const heights = await page
    .locator('nav[aria-label="AI Roadmap"] a, main a, main button')
    .evaluateAll((elements) =>
      elements
        .filter(
          (element) =>
            element.checkVisibility() &&
            element.closest("p") === null &&
            getComputedStyle(element).display !== "inline",
        )
        .map((element) => ({
          target: element.outerHTML.slice(0, 160),
          height: element.getBoundingClientRect().height,
        })),
    );
  expect(heights.length).toBeGreaterThan(0);
  for (const { target, height } of heights) expect(height, target).toBeGreaterThanOrEqual(44);
}

// The page's robots tag; roadmap pages are indexed, so it is absent.
function robots(page: Page) {
  return page.locator('meta[name="robots"]');
}

function books(page: Page) {
  return page.getByRole("list", { name: "Books" }).locator(":scope > li");
}

/** The page's JSON-LD nodes. */
async function graphNodes(page: Page): Promise<Record<string, unknown>[]> {
  const graphs = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((scripts) => scripts.map((script) => JSON.parse(script.textContent) as unknown));
  return graphs.flatMap(
    (graph) => (graph as { "@graph"?: Record<string, unknown>[] })["@graph"] ?? [],
  );
}

/** A progress fact's value on a book's page, by its term. */
function fact(page: Page, term: string) {
  return page.locator("main dl > div").filter({ has: page.locator("dt", { hasText: term }) });
}

test.describe.configure({ mode: "serial" });

test.describe("the bookshelf", () => {
  let api: Started;
  let website: Started;
  let key: string;
  let keyFile: string;

  test.beforeAll(async () => {
    // A disposable secret and key for this run only.
    const secret = randomBytes(32).toString("hex");
    await mkdir(scratch, { recursive: true });
    keyFile = `${scratch}e2e-api-key-${randomBytes(6).toString("hex")}`;
    const webPort = await freePort(required("WEB_HOST"));
    api = await startApi("with-bookshelf", {
      invalidation: {
        url: `${origin(required("WEB_HOST"), webPort)}/internal/invalidation`,
        secret,
      },
      keyFile,
    });
    key = (await readFile(keyFile, "utf8")).trim();
    website = await startWebsite(api.url, { port: webPort, invalidationSecret: secret });
  });

  test.afterAll(async () => {
    await website.stop();
    await api.stop();
    await rm(keyFile, { force: true });
  });

  async function write(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown) {
    const response = await fetch(`${api.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.ok, `${method} ${path} answers ${String(response.status)}`).toBe(true);
    return response.status === 204 ? null : (response.json() as Promise<unknown>);
  }

  // The page's HTML without React's text separators (`<!-- -->`), so adjacent text reads as shown.
  async function text(path: string): Promise<string> {
    const response = await fetch(`${website.url}${path}`);
    return (await response.text()).replaceAll("<!-- -->", "");
  }

  async function status(path: string): Promise<number> {
    const response = await fetch(`${website.url}${path}`);
    await response.body?.cancel();
    return response.status;
  }

  test("lists every book in shelf order with its status, author and cover, open to search engines", async ({
    page,
  }) => {
    const response = await page.goto(`${website.url}${shelf}`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`Bookshelf · AI Engineering Roadmap · ${name}`);
    await expect(robots(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bookshelf");
    await expect(
      page.getByRole("navigation", { name: "AI Roadmap" }).locator('[aria-current="page"]'),
    ).toHaveText("Bookshelf");

    await expect(books(page)).toHaveCount(3);
    await expect(books(page).getByRole("heading", { level: 2 })).toHaveText([
      "The Quiet Orbit Handbook",
      "Drifting Signals",
      "A Bare Volume",
    ]);
    const [first, second, third] = [books(page).nth(0), books(page).nth(1), books(page).nth(2)];
    await expect(first).toContainText("01");
    await expect(first).toContainText("Completed");
    await expect(first).toContainText("Ada Example");
    await expect(first.locator("strong")).toHaveText("fictional");
    await expect(second).toContainText("Reading");
    await expect(second).toContainText("Mira Sample");
    await expect(third).toContainText("03");
    await expect(third).toContainText("To read");
    await expect(first.getByRole("link", { name: "The Quiet Orbit Handbook" })).toHaveAttribute(
      "href",
      completedBook,
    );

    // The cover is served from the site's own media path; a book without one has a placeholder.
    const cover = first.locator('img[data-slot="book-cover"]');
    await expect(cover).toHaveAttribute(
      "alt",
      "A placeholder cover for the fictional quiet orbit handbook.",
    );
    await expect
      .poll(() => cover.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
    expect(new URL((await cover.getAttribute("src")) ?? "", website.url).host).toBe(
      new URL(website.url).host,
    );
    for (const row of [second, third]) {
      await expect(row.locator('img[data-slot="book-cover"]')).toHaveCount(0);
      await expect(row.locator('[data-slot="book-cover-placeholder"]')).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    }
  });

  test("a completed book shows its facts, progress, reading time, resource and summary", async ({
    page,
  }) => {
    const response = await page.goto(`${website.url}${completedBook}`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`The Quiet Orbit Handbook · Bookshelf · ${name}`);
    await expect(robots(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("The Quiet Orbit Handbook");
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("listitem"),
    ).toHaveText(["AI Engineering Roadmap", "Bookshelf", "The Quiet Orbit Handbook"]);
    const main = page.locator("main");
    await expect(main).toContainText("Completed");
    await expect(main).toContainText("Ada Example");
    await expect(page.getByRole("list", { name: "Book facts" }).getByRole("listitem")).toHaveText([
      "248 pages",
      "Published 2024",
      "ISBN 978-0-00-000000-2",
    ]);
    await expect(fact(page, "Started").locator("time")).toHaveAttribute("datetime", "2026-02-20");
    await expect(fact(page, "Started")).toContainText("February 20th, 2026");
    await expect(fact(page, "Completed").locator("time")).toHaveAttribute("datetime", "2026-03-03");
    // The hour logged on its resource across Prague midnight, as the diary counts it.
    await expect(fact(page, "Time logged")).toContainText("1h");
    await expect(
      fact(page, "Read through").getByRole("link", { name: "A fictional book on signals" }),
    ).toHaveAttribute("href", `${modulePage}#resource-signal-book`);
    await expect(page.getByRole("heading", { level: 2, name: "Summary" })).toBeVisible();
    // The summary's own heading is unwrapped to text, so the page's outline stays the template's.
    const summary = main.locator("section", {
      has: page.getByRole("heading", { name: "Summary" }),
    });
    await expect(summary).toContainText("What stayed");
    await expect(summary.getByRole("heading")).toHaveCount(1);
    await expect(summary.getByRole("listitem").first()).toHaveText(
      "Read the signal twice before acting on it.",
    );
    await expect(page.getByRole("link", { name: "Go to the bookshelf" })).toHaveAttribute(
      "href",
      shelf,
    );
  });

  test("a book being read and a book with only its title invent nothing", async ({ page }) => {
    await page.goto(`${website.url}${readingBook}`);
    await expect(page.locator("main")).toContainText("Reading");
    await expect(fact(page, "Started")).toContainText("March 1st, 2026");
    await expect(fact(page, "Completed")).toContainText("Not yet");
    await expect(fact(page, "Time logged")).toHaveCount(0);
    await expect(fact(page, "Read through")).toHaveCount(0);

    await page.goto(`${website.url}${bareBook}`);
    const main = page.locator("main");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A Bare Volume");
    await expect(main).toContainText("To read");
    await expect(page.getByRole("list", { name: "Book facts" })).toHaveCount(0);
    await expect(fact(page, "Started")).toContainText("Not yet");
    await expect(fact(page, "Completed")).toContainText("Not yet");
    await expect(page.getByRole("heading", { level: 2, name: "Summary" })).toHaveCount(0);
    await expect(main.locator('img[data-slot="book-cover"]')).toHaveCount(0);
    await expect(main.locator('[data-slot="book-cover-placeholder"]')).toHaveCount(1);
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect(description).not.toBe("");
  });

  test("a resource and a diary session lead to their book, and the book leads back", async ({
    page,
  }) => {
    await page.goto(`${website.url}${modulePage}`);
    const resource = page.locator("#resource-signal-book");
    const toBook = resource.getByRole("link", {
      name: "On the bookshelf: A fictional book on signals",
    });
    await expect(toBook).toHaveAttribute("href", completedBook);
    // Only the resource that reads a book leads to one.
    await expect(page.getByRole("link", { name: /^On the bookshelf/u })).toHaveCount(1);
    await toBook.click();
    await expect(page).toHaveURL(`${website.url}${completedBook}`);

    await page.getByRole("link", { name: "A fictional book on signals" }).click();
    await expect(page).toHaveURL(`${website.url}${modulePage}#resource-signal-book`);
    await expect(page.locator("#resource-signal-book")).toBeInViewport();

    await page.goto(`${website.url}${diaryDay}`);
    await expect(
      page.getByRole("link", { name: "On the bookshelf: A fictional book on signals" }),
    ).toHaveAttribute("href", completedBook);
  });

  test("the bookshelf and a book carry their structured data and preview images", async ({
    page,
    request,
  }) => {
    await page.goto(`${website.url}${shelf}`);
    const list = (await graphNodes(page)).find((node) => node["@type"] === "ItemList") as
      { numberOfItems: number; itemListElement: { name: string; url: string }[] } | undefined;
    expect(list?.numberOfItems).toBe(3);
    expect(list?.itemListElement.map((item) => item.name)).toEqual([
      "The Quiet Orbit Handbook by Ada Example",
      "Drifting Signals by Mira Sample",
      "A Bare Volume",
    ]);
    expect(new URL(list?.itemListElement[0]?.url ?? "").pathname).toBe(completedBook);

    await page.goto(`${website.url}${completedBook}`);
    const book = (await graphNodes(page)).find((node) => node["@type"] === "Book") as
      { name: string; author: { name: string }; isbn: string; numberOfPages: number } | undefined;
    expect(book).toMatchObject({
      name: "The Quiet Orbit Handbook",
      author: { name: "Ada Example" },
      isbn: "978-0-00-000000-2",
      numberOfPages: 248,
    });
    const crumbs = (await graphNodes(page)).find((node) => node["@type"] === "BreadcrumbList") as
      { itemListElement: { name: string }[] } | undefined;
    expect(crumbs?.itemListElement.map((item) => item.name)).toEqual([
      "AI Engineering Roadmap",
      "Bookshelf",
      "The Quiet Orbit Handbook",
    ]);

    for (const path of [shelf, completedBook]) {
      await page.goto(`${website.url}${path}`);
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
        "content",
        "summary_large_image",
      );
      const image = await page.locator('meta[property="og:image"]').getAttribute("content");
      expect(new URL(image ?? "").pathname, path).toBe(`/og${path}`);
      const preview = await request.get(`${website.url}/og${path}`);
      expect(preview.status(), path).toBe(200);
      expect(preview.headers()["content-type"], path).toBe("image/png");
    }
    expect((await request.get(`${website.url}/og${shelf}/no-such-book`)).status()).toBe(404);
  });

  test("a book that does not exist, or an address that is not a slug, is not found", async () => {
    for (const path of [`${shelf}/no-such-book`, `${shelf}/Not%20A%20Slug`]) {
      expect(await status(path), path).toBe(404);
    }
  });

  test("renders the summary as text: no script, image, raw markup or javascript: link", async ({
    page,
  }) => {
    await page.goto(`${website.url}${completedBook}`);
    const summary = page.locator("section", {
      has: page.getByRole("heading", { level: 2, name: "Summary" }),
    });
    await expect(summary).toContainText("a trap");
    await expect(summary.locator("script, img, b, iframe")).toHaveCount(0);
    await expect(page.locator('main a[href^="javascript:"]')).toHaveCount(0);
    expect(await page.evaluate(() => "__bookInjected" in window)).toBe(false);
    await page.setViewportSize({ width: 360, height: 800 });
    await expectNoHorizontalScroll(page);
  });

  test("the keyboard reaches a book from the shelf and the breadcrumbs lead back", async ({
    page,
  }) => {
    await page.goto(`${website.url}${shelf}`);
    const first = page.getByRole("link", { name: "The Quiet Orbit Handbook" });
    for (let step = 0; step < 30; step += 1) {
      await page.keyboard.press("Tab");
      if (await first.evaluate((element) => element === document.activeElement)) break;
    }
    await expect(first).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Drifting Signals" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${website.url}${readingBook}`);

    const back = page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Bookshelf" });
    await back.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${website.url}${shelf}`);
  });

  test("fits every width and mode, accessible and with large targets", async ({ page }) => {
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [label, path] of [
        ["shelf", shelf],
        ["completed", completedBook],
        ["bare", bareBook],
        ["module", modulePage],
        ["diary-day", diaryDay],
      ] as const) {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(`${website.url}${path}`);
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          await expectNoHorizontalScroll(page);
          await expectTouchTargets(page);
          await page.screenshot({
            path: test.info().outputPath(`bookshelf-${label}-${String(width)}-${scheme}.png`),
            fullPage: true,
          });
          if (width === 360 || width === 1280) await expectAccessible(page);
        }
      }
    }
  });

  test("book, link and time writes reach the warmed shelf, book pages, module page and diary", async () => {
    // Warm every page the writes will change.
    expect(await text(shelf)).toContain("The Quiet Orbit Handbook");
    expect(await text(completedBook)).toContain("A fictional book on signals");
    expect(await text(readingBook)).not.toContain("Read through");
    expect(await text(modulePage)).toContain(`href="${completedBook}"`);
    expect(await text(diaryDay)).toContain(`href="${completedBook}"`);

    // A book's own fields.
    await write("PATCH", "/v1/roadmap/books/quiet-orbit-handbook", {
      title: "The Rewritten Orbit Handbook",
    });
    await expect.poll(() => text(shelf), within).toContain("The Rewritten Orbit Handbook");
    await expect.poll(() => text(completedBook), within).toContain("The Rewritten Orbit Handbook");

    // Time logged on its resource.
    await write("POST", "/v1/roadmap/time-entries", {
      resource: "signal-book",
      startedAt: "2026-03-05T18:00:00+01:00",
      endedAt: "2026-03-05T18:30:00+01:00",
    });
    await expect.poll(() => text(completedBook), within).toContain("1h 30m");

    // Moving the link changes the former book, the new book and the module page.
    await write("PATCH", "/v1/roadmap/resources/signal-book", { book: "drifting-signals" });
    await expect.poll(() => text(completedBook), within).not.toContain("Read through");
    await expect.poll(() => text(readingBook), within).toContain("A fictional book on signals");
    await expect.poll(() => text(modulePage), within).toContain(`href="${readingBook}"`);
    expect(await text(modulePage)).not.toContain(`href="${completedBook}"`);
    await expect.poll(() => text(diaryDay), within).toContain(`href="${readingBook}"`);
    expect(await text(diaryDay)).not.toContain(`href="${completedBook}"`);

    // A book no resource links can be deleted; its page and row go.
    await write("DELETE", "/v1/roadmap/books/quiet-orbit-handbook");
    await expect.poll(() => status(completedBook), within).toBe(404);
    await expect.poll(() => text(shelf), within).not.toContain("The Rewritten Orbit Handbook");
  });
});

test.describe("an empty bookshelf", () => {
  // The main stack's fixture (with-photo) has a profile and no book.
  test("says there are no books yet", async ({ page }) => {
    const response = await page.goto(shelf);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bookshelf");
    await expect(page.locator("main")).toContainText("No books yet.");
    await expect(page.getByRole("list", { name: "Books" })).toHaveCount(0);
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 360, height: 800 });
      await page.screenshot({ path: test.info().outputPath(`bookshelf-empty-360-${scheme}.png`) });
    }
    await expectAccessible(page);
  });
});

test.describe("an unreachable API", () => {
  let website: Started;

  test.beforeAll(async () => {
    // Nothing listens on this port: every read fails.
    const silent = origin(required("API_HOST"), await freePort(required("API_HOST")));
    website = await startWebsite(silent);
  });

  test.afterAll(async () => {
    await website.stop();
  });

  test("the shelf and a book show the unavailable state, never empty or not found", async ({
    page,
  }) => {
    for (const path of [shelf, completedBook]) {
      const response = await page.goto(`${website.url}${path}`);
      expect(response?.status(), path).toBe(500);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(unavailable);
    }
    await expectAccessible(page);
  });
});
