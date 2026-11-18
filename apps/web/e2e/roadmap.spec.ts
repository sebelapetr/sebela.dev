// The AI Roadmap overview against the fictional roadmap of e2e/fixtures/with-roadmap/ (Robin
// Ashby): three areas (one in progress with a long description, one planned, one without
// modules), a module without resources and five resources of every status, one whose description
// tries to inject markup and a `javascript:` link. It covers the content and its counts, opening
// areas and modules by pointer and keyboard, safe rendering, the sub-navigation that only roadmap
// pages show, the temporary placeholders, the empty and the unavailable state, and a roadmap
// write reaching the warmed page through the signed invalidation. Widths, themes, axe and touch
// targets are checked on the overview with its first area open.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freePort, origin, required, startApi, startWebsite, type Started } from "./stack";

const scratch = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
const within = { timeout: 10_000, intervals: [250] };

const name = "Robin Ashby";
const title = "AI Engineering Roadmap for Experienced Developers";
const unavailable = "This page could not be loaded right now.";
const widths = [360, 768, 1280] as const;
const schemes = ["light", "dark"] as const;

const sections = [
  { path: "/ai-roadmap/diary", label: "Learning Diary" },
  { path: "/ai-roadmap/bookshelf", label: "Bookshelf" },
  { path: "/ai-roadmap/events", label: "Events" },
] as const;

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

// Every visible link and button of the sub-navigation and the content outside running text is at
// least 44 px tall (docs/design.md, Components); links inside a description's paragraphs are not.
async function expectTouchTargets(page: Page) {
  const heights = await page
    .locator('nav[aria-label="AI Roadmap"] a, main a, main button')
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.checkVisibility() && element.closest("p") === null)
        .map((element) => ({
          target: element.outerHTML.slice(0, 160),
          height: element.getBoundingClientRect().height,
        })),
    );
  expect(heights.length).toBeGreaterThan(0);
  for (const { target, height } of heights) expect(height, target).toBeGreaterThanOrEqual(44);
}

/** Waits until the page is hydrated, so the timeline's items open and close. */
async function hydrated(page: Page) {
  await page.waitForFunction(
    () => (window.history.state as { __NA?: boolean } | null)?.__NA === true,
  );
}

function subNavigation(page: Page) {
  return page.getByRole("navigation", { name: "AI Roadmap" });
}

/** An area's or a module's heading row, by the start of its accessible name. */
function trigger(page: Page, label: string) {
  return page.getByRole("button", { name: new RegExp(`^${label}`, "u") });
}

function robots(page: Page) {
  return page.locator('meta[name="robots"]').getAttribute("content");
}

test.describe.configure({ mode: "serial" });

test.describe("the roadmap overview", () => {
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
    api = await startApi("with-roadmap", {
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

  async function text(path: string): Promise<string> {
    const response = await fetch(`${website.url}${path}`);
    return response.text();
  }

  test("shows the counts, the planned hours and the way in, kept out of search results", async ({
    page,
  }) => {
    const response = await page.goto(`${website.url}/ai-roadmap`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`AI Engineering Roadmap — ${name}`);
    expect(await robots(page)).toContain("noindex");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    // 90 + 30 + 600 planned minutes are 12 hours; resources without an estimate add nothing.
    await expect(page.locator("main header p").first()).toContainText(
      "3 areas, 3 modules, 5 vetted resources, roughly 12 hours of study and implementation.",
    );
    await expect(
      page.getByRole("link", { name: /^Start here: Orbit foundations/u }),
    ).toHaveAttribute("href", "/ai-roadmap/orbit-foundations");
    await expect(page.getByRole("link", { name: "Who's building this" })).toHaveAttribute(
      "href",
      "/",
    );
    // Areas in their order, each with its progress for screen readers: skipped counts in the
    // denominator only, and an area without resources reads 0 of 0.
    const areas = page.getByRole("region", { name: "Learning roadmap" }).locator("h2");
    await expect(areas).toHaveText([
      /^1\.Orbit foundationsCurrent.*1 of 4 resources completed/u,
      /^2\.Quiet systems.*0 of 1 resources completed/u,
      /^3\.Later ideas.*0 of 0 resources completed/u,
    ]);
    await expect(page.getByRole("heading", { name: "Learning approach" })).toBeVisible();
  });

  test("opens areas and modules by pointer, shows their content and links out safely", async ({
    page,
  }) => {
    await page.goto(`${website.url}/ai-roadmap`);
    await hydrated(page);
    const area = trigger(page, "Orbit foundations");
    await expect(area).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText("Signal basics")).toBeHidden();

    await area.click();
    await expect(area).toHaveAttribute("aria-expanded", "true");
    const modules = page.getByRole("list", { name: "Modules of Orbit foundations" });
    await expect(modules.locator("h3")).toHaveText([/Signal basics/u, /Empty drawer/u]);

    await trigger(page, "Signal basics").click();
    const resources = page.getByRole("list", { name: "Resources of Signal basics" });
    await expect(resources.locator("h4")).toHaveText([
      /A fictional signal explainer \(opens in a new tab\), Completed/u,
      /Unsafe signal notes, In progress/u,
      /A signal playground, Skipped/u,
      /A fictional book on signals, Paused/u,
    ]);
    const link = resources.getByRole("link", { name: /A fictional signal explainer/u });
    await expect(link).toHaveAttribute("href", "https://learn.example.test/signal-explainer");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(resources).toContainText("~1.5h");

    await trigger(page, "Empty drawer").click();
    await expect(page.getByText("No resources yet.")).toBeVisible();
    await trigger(page, "Later ideas").click();
    await expect(page.getByText("No modules yet.")).toBeVisible();

    await area.click();
    await expect(area).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText("Signal basics")).toBeHidden();
  });

  test("the keyboard opens and closes areas, and Show more opens a long description", async ({
    page,
  }) => {
    await page.goto(`${website.url}/ai-roadmap`);
    await hydrated(page);
    const area = trigger(page, "Orbit foundations");
    await area.focus();
    await page.keyboard.press("Enter");
    await expect(area).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Space");
    await expect(area).toHaveAttribute("aria-expanded", "false");

    // The long description is cut while the area is closed; Show more opens the area.
    const more = page.getByRole("button", { name: "Show more about Orbit foundations" });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(area).toHaveAttribute("aria-expanded", "true");
    await expect(more).toHaveCount(0);
    // Short descriptions have nothing more to show.
    await expect(page.getByRole("button", { name: "Show more about Quiet systems" })).toHaveCount(
      0,
    );
  });

  test("renders descriptions as text: no script, image, raw markup or javascript: link", async ({
    page,
  }) => {
    await page.goto(`${website.url}/ai-roadmap`);
    await hydrated(page);
    await trigger(page, "Orbit foundations").click();
    await trigger(page, "Signal basics").click();
    const notes = page.locator('[data-roadmap-slug="signal-notes"]');
    await expect(notes).toContainText("a trap");
    await expect(notes.locator("script, img, b, iframe")).toHaveCount(0);
    await expect(page.locator('main a[href^="javascript:"]')).toHaveCount(0);
    expect(await page.evaluate(() => "__roadmapInjected" in window)).toBe(false);
  });

  test("fits every width and mode with the first area open, accessible and with large targets", async ({
    page,
  }) => {
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${website.url}/ai-roadmap`);
      await hydrated(page);
      await trigger(page, "Orbit foundations").click();
      await trigger(page, "Signal basics").click();
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalScroll(page);
        await expectTouchTargets(page);
        await page.screenshot({
          path: test.info().outputPath(`roadmap-${String(width)}-${scheme}.png`),
          fullPage: true,
        });
      }
      await expectAccessible(page);
    }
  });

  test("the sub-navigation shows on roadmap pages only and marks the current one", async ({
    page,
  }) => {
    for (const { path, current } of [
      { path: "/ai-roadmap", current: "Roadmap" },
      { path: "/ai-roadmap/orbit-foundations", current: "Roadmap" },
      ...sections.map(({ path, label }) => ({ path, current: label })),
    ]) {
      await page.goto(`${website.url}${path}`);
      const nav = subNavigation(page);
      await expect(nav.getByRole("link")).toHaveText([
        "AI Engineering Roadmap",
        "Roadmap",
        "Learning Diary",
        "Bookshelf",
        "Events",
      ]);
      await expect(nav.locator('[aria-current="page"]')).toHaveText(current);
      // It sits under the site header, before the content.
      const below = await page.evaluate(() => {
        const header = document.querySelector("body header");
        const subnav = document.querySelector('nav[aria-label="AI Roadmap"]');
        return (
          (header?.getBoundingClientRect().bottom ?? 0) <=
          (subnav?.getBoundingClientRect().top ?? -1)
        );
      });
      expect(below, path).toBe(true);
    }
    for (const path of ["/", "/ask", "/missing-page"]) {
      await page.goto(`${website.url}${path}`);
      await expect(subNavigation(page), path).toHaveCount(0);
    }
  });

  test("unfinished pages are explicit placeholders, and an unknown area is not found", async ({
    page,
  }) => {
    for (const { path, label } of sections) {
      const response = await page.goto(`${website.url}${path}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(label);
      await expect(page.locator("main")).toContainText("is not published yet");
      expect(await robots(page)).toContain("noindex");
      await expect(page.getByRole("link", { name: /Back to the roadmap/u })).toHaveAttribute(
        "href",
        "/ai-roadmap",
      );
    }

    const response = await page.goto(`${website.url}/ai-roadmap/orbit-foundations`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Orbit foundations");
    await expect(page.locator("main")).toContainText("This area's own page is not published yet.");
    expect(await robots(page)).toContain("noindex");
    await expectAccessible(page);

    const missing = await page.goto(`${website.url}/ai-roadmap/no-such-area`);
    expect(missing?.status()).toBe(404);
  });

  test("a roadmap write reaches the warmed overview within ten seconds", async () => {
    const overview = await text("/ai-roadmap");
    expect(overview).toContain("Quiet systems");
    expect(overview).toContain("A fictional queue guide");

    await write("PATCH", "/v1/roadmap/areas/quiet-systems", { name: "Quieter systems" });
    await expect.poll(() => text("/ai-roadmap"), within).toContain("Quieter systems");

    await write("DELETE", "/v1/roadmap/resources/queue-guide");
    await expect.poll(() => text("/ai-roadmap"), within).not.toContain("A fictional queue guide");
    expect(await text("/ai-roadmap")).toContain("4 vetted resources");
    // The area's own address follows the same content.
    expect(await text("/ai-roadmap/quiet-systems")).toContain("Quieter systems");
  });
});

test.describe("a profile without a roadmap", () => {
  // The main stack's fixture (e2e/fixtures/with-photo/) has a person and no roadmap areas.
  test("says that no areas are published and offers no way in", async ({ page }) => {
    const response = await page.goto("/ai-roadmap");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.locator("main")).toContainText("No roadmap areas are published yet.");
    await expect(page.getByRole("link", { name: /^Start here/u })).toHaveCount(0);
    await expect(subNavigation(page)).toBeVisible();
    await expectAccessible(page);
    const missing = await page.goto("/ai-roadmap/orbit-foundations");
    expect(missing?.status()).toBe(404);
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

  test("the overview shows the unavailable state; the static placeholders still load", async ({
    page,
  }) => {
    const response = await page.goto(`${website.url}/ai-roadmap`);
    expect(response?.status()).toBe(500);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(unavailable);
    await expectAccessible(page);
    for (const { path } of sections) {
      const placeholder = await page.goto(`${website.url}${path}`);
      expect(placeholder?.status(), path).toBe(200);
      await expect(subNavigation(page)).toBeVisible();
    }
  });
});
