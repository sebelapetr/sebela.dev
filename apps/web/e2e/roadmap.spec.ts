// The AI Roadmap against the fictional roadmap of e2e/fixtures/with-roadmap/ (Robin Ashby): three
// areas (one in progress with a long description, one planned, one without modules), a module
// without resources and five resources of every status, one whose description tries to inject
// markup and a `javascript:` link. It covers the overview's content and counts, opening areas and
// modules by pointer and keyboard, the area and module pages with their breadcrumbs, last change,
// adjacent areas, way back to the full roadmap, titles, structured data and preview images, a
// module only under its own area, a resource's anchor, the chat's roadmap card
// and source, the homepage's Exploring, safe rendering, the sub-navigation that only roadmap pages
// show, the static placeholders, the empty and the unavailable state, and roadmap writes reaching
// the warmed overview, old and new detail pages and the homepage through the signed invalidation.
// Widths, themes, axe and touch targets are checked on the overview with its first area open and
// on the area and module pages.
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

// No marker on the rail covers the text of its row: every visible marker ends left of where its
// area's, module's or resource's name starts. A resource's name is an `h4` on the overview and an
// `h3` on its module's page.
async function expectMarkersBesideNames(page: Page, resourceHeading: "h3" | "h4" = "h4") {
  const rows = await page.locator('main [data-slot="timeline-marker"]').evaluateAll(
    (markers, heading) =>
      markers
        .filter((marker) => marker.checkVisibility())
        .map((marker) => {
          const item = marker.closest("li");
          const name = item?.querySelector(
            `:scope > div > ${heading}, :scope > div > :is(h2, h3) > button > span:not([data-slot])`,
          );
          if (name === null || name === undefined) return { row: marker.outerHTML, gap: -1 };
          const range = document.createRange();
          range.selectNodeContents(name);
          const text = range.getClientRects()[0];
          return {
            row: name.textContent.slice(0, 60),
            gap: (text?.left ?? 0) - marker.getBoundingClientRect().right,
          };
        }),
    resourceHeading,
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const { row, gap } of rows) expect(gap, row).toBeGreaterThanOrEqual(4);
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

function breadcrumbs(page: Page) {
  return page.getByRole("navigation", { name: "Breadcrumb" });
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

  async function status(path: string): Promise<number> {
    const response = await fetch(`${website.url}${path}`);
    await response.body?.cancel();
    return response.status;
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
    await expect(page.getByRole("list", { name: "Modules of Orbit foundations" })).toBeHidden();

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
    await expect(page.getByRole("list", { name: "Modules of Orbit foundations" })).toBeHidden();
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
        await expectMarkersBesideNames(page);
        await page.screenshot({
          path: test.info().outputPath(`roadmap-${String(width)}-${scheme}.png`),
          fullPage: true,
        });
        // axe at the narrowest and the widest layout: wrapping and the side column differ.
        if (width === 360 || width === 1280) await expectAccessible(page);
      }
    }
  });

  test("the sub-navigation shows on roadmap pages only and marks the current one", async ({
    page,
  }) => {
    for (const { path, current } of [
      { path: "/ai-roadmap", current: "Roadmap" },
      { path: "/ai-roadmap/orbit-foundations", current: "Roadmap" },
      { path: "/ai-roadmap/orbit-foundations/signal-basics", current: "Roadmap" },
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

  test("the static sections are explicit placeholders; unknown and unrelated pages are not found", async ({
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

    for (const path of [
      "/ai-roadmap/no-such-area",
      "/ai-roadmap/orbit-foundations/no-such-module",
      // A module exists only under its own area.
      "/ai-roadmap/quiet-systems/signal-basics",
      // Not a slug: the API rejects it, and the page is simply not found.
      "/ai-roadmap/Orbit%20Foundations",
      "/ai-roadmap/orbit-foundations/Signal%20Basics",
    ]) {
      const missing = await page.goto(`${website.url}${path}`);
      expect(missing?.status(), path).toBe(404);
    }
  });

  test("the overview leads to an area's page and a module's page, and the breadcrumbs lead back", async ({
    page,
  }) => {
    await page.goto(`${website.url}/ai-roadmap`);
    await hydrated(page);
    await trigger(page, "Orbit foundations").click();
    await page.getByRole("link", { name: "Open the area page: Orbit foundations" }).click();

    await expect(page).toHaveURL(/\/ai-roadmap\/orbit-foundations$/u);
    await expect(page).toHaveTitle(`Orbit foundations — AI Engineering Roadmap — ${name}`);
    expect(await robots(page)).toContain("noindex");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Orbit foundations");
    await expect(breadcrumbs(page).getByRole("link")).toHaveText(["AI Engineering Roadmap"]);
    await expect(breadcrumbs(page).locator('[aria-current="page"]')).toHaveText(
      "Orbit foundations",
    );
    // The API's derived values, as on the overview: skipped counts in the denominator only.
    const header = page.locator("main header");
    await expect(header).toContainText("Current");
    await expect(header).toContainText("In progress");
    await expect(header).toContainText("1/4");
    await expect(header).toContainText(/Updated [A-Z][a-z]+ \d{1,2}, \d{4}/u);
    // The modules in the API's order on the timeline, as on the overview: each opens to its
    // resources and leads to its own page.
    const modules = page.getByRole("list", { name: "Modules of Orbit foundations" });
    await expect(modules.locator(":scope > li h3")).toHaveText([/Signal basics/u, /Empty drawer/u]);
    await expect(modules.locator(":scope > li").nth(0)).toContainText("Reading fictional signals.");
    await hydrated(page);
    await trigger(page, "Signal basics").click();
    await expect(page.getByRole("list", { name: "Resources of Signal basics" })).toContainText(
      "A fictional signal explainer",
    );
    // The areas around it in the roadmap's order: the first area has only a next one.
    const adjacent = page.getByRole("navigation", { name: "Adjacent learning areas" });
    await expect(adjacent.getByRole("link")).toHaveText([/Next area\s*Quiet systems/u]);
    await expect(adjacent.getByRole("link", { name: "Next area Quiet systems" })).toHaveAttribute(
      "href",
      "/ai-roadmap/quiet-systems",
    );
    await expect(page.getByRole("link", { name: "Go to full roadmap" })).toHaveAttribute(
      "href",
      "/ai-roadmap",
    );

    await page.getByRole("link", { name: "Open the module page: Signal basics" }).click();
    await expect(page).toHaveURL(/\/ai-roadmap\/orbit-foundations\/signal-basics$/u);
    await expect(page).toHaveTitle(
      `Signal basics — Orbit foundations — AI Engineering Roadmap — ${name}`,
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Signal basics");
    await expect(page.locator("main header")).toContainText("Module of Orbit foundations");
    await expect(page.locator("main header")).toContainText(/Updated [A-Z][a-z]+ \d{1,2}, \d{4}/u);
    // A module's page has no adjacent areas, only the way back to the full roadmap.
    await expect(page.getByRole("navigation", { name: "Adjacent learning areas" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Go to full roadmap" })).toHaveAttribute(
      "href",
      "/ai-roadmap",
    );
    const resources = page.getByRole("list", { name: "Resources of Signal basics" });
    await expect(resources.locator("h3")).toHaveText([
      /A fictional signal explainer \(opens in a new tab\), Completed/u,
      /Unsafe signal notes, In progress/u,
      /A signal playground, Skipped/u,
      /A fictional book on signals, Paused/u,
    ]);
    await expect(resources).toContainText("~1.5h");
    await expect(resources).toContainText("Book");
    const link = resources.getByRole("link", { name: /A fictional signal explainer/u });
    await expect(link).toHaveAttribute("href", "https://learn.example.test/signal-explainer");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");

    await breadcrumbs(page).getByRole("link", { name: "Orbit foundations" }).click();
    await expect(page).toHaveURL(/\/ai-roadmap\/orbit-foundations$/u);
    await breadcrumbs(page).getByRole("link", { name: "AI Engineering Roadmap" }).click();
    await expect(page).toHaveURL(/\/ai-roadmap$/u);

    // The overview's opened module leads to its page too.
    await hydrated(page);
    await trigger(page, "Orbit foundations").click();
    await trigger(page, "Signal basics").click();
    await page.getByRole("link", { name: "Open the module page: Signal basics" }).click();
    await expect(page).toHaveURL(/\/ai-roadmap\/orbit-foundations\/signal-basics$/u);
  });

  test("the keyboard opens a module, follows its link, the adjacent areas and the breadcrumbs", async ({
    page,
  }) => {
    await page.goto(`${website.url}/ai-roadmap/quiet-systems`);
    await hydrated(page);
    // The middle area has both neighbours.
    const adjacent = page.getByRole("navigation", { name: "Adjacent learning areas" });
    await expect(adjacent.getByRole("link")).toHaveText([
      /Previous area\s*Orbit foundations/u,
      /Next area\s*Later ideas/u,
    ]);
    const previous = adjacent.getByRole("link", { name: "Previous area Orbit foundations" });
    await previous.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/ai-roadmap\/orbit-foundations$/u);

    await hydrated(page);
    const item = trigger(page, "Empty drawer");
    await item.focus();
    await page.keyboard.press("Enter");
    await expect(item).toHaveAttribute("aria-expanded", "true");
    const drawer = page.getByRole("link", { name: "Open the module page: Empty drawer" });
    await drawer.focus();
    await expect(drawer).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/ai-roadmap\/orbit-foundations\/empty-drawer$/u);
    await expect(page.locator("main")).toContainText("No resources yet.");

    const crumb = breadcrumbs(page).getByRole("link", { name: "Orbit foundations" });
    await crumb.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/ai-roadmap\/orbit-foundations$/u);
  });

  test("an area without modules and a module without resources say so", async ({ page }) => {
    const area = await page.goto(`${website.url}/ai-roadmap/later-ideas`);
    expect(area?.status()).toBe(200);
    await expect(page.locator("main")).toContainText("No modules yet.");
    await expect(page.locator("main header")).toContainText("0/0");
    await expectAccessible(page);

    const drawer = await page.goto(`${website.url}/ai-roadmap/orbit-foundations/empty-drawer`);
    expect(drawer?.status()).toBe(200);
    await expect(page.locator("main")).toContainText("No resources yet.");
    await expectAccessible(page);
  });

  test("the module page renders descriptions as text: no script, image, raw markup or javascript: link", async ({
    page,
  }) => {
    await page.goto(`${website.url}/ai-roadmap/orbit-foundations/signal-basics`);
    await hydrated(page);
    const notes = page.locator('[data-roadmap-slug="signal-notes"]');
    await expect(notes).toContainText("a trap");
    await expect(notes.locator("script, img, b, iframe")).toHaveCount(0);
    await expect(page.locator('main a[href^="javascript:"]')).toHaveCount(0);
    expect(await page.evaluate(() => "__roadmapInjected" in window)).toBe(false);
  });

  test("each page describes its way from the overview, itself as a course and its preview at its own address", async ({
    page,
    request,
  }) => {
    for (const { path, names, partOf } of [
      {
        path: "/ai-roadmap/orbit-foundations",
        names: ["AI Engineering Roadmap", "Orbit foundations"],
        partOf: null,
      },
      {
        path: "/ai-roadmap/orbit-foundations/signal-basics",
        names: ["AI Engineering Roadmap", "Orbit foundations", "Signal basics"],
        partOf: "/ai-roadmap/orbit-foundations",
      },
    ]) {
      await page.goto(`${website.url}${path}`);
      const graphs = await page
        .locator('script[type="application/ld+json"]')
        .evaluateAll((scripts) =>
          scripts.map((script) => JSON.parse(script.textContent) as unknown),
        );
      const list = graphs
        .flatMap((graph) => (graph as { "@graph"?: unknown[] })["@graph"] ?? [])
        .find(
          (node): node is { itemListElement: { name: string; item: string }[] } =>
            (node as { "@type"?: string })["@type"] === "BreadcrumbList",
        );
      expect(
        list?.itemListElement.map((item) => item.name),
        path,
      ).toEqual(names);
      expect(new URL(list?.itemListElement.at(-1)?.item ?? "").pathname, path).toBe(path);
      const description = await page.locator('meta[name="description"]').getAttribute("content");
      expect(description, path).not.toBe("");
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
        "content",
        new RegExp(`^${names.at(-1) ?? ""} — `, "u"),
      );

      // The page as a course by the person, part of its area for a module.
      const course = graphs
        .flatMap((graph) => (graph as { "@graph"?: unknown[] })["@graph"] ?? [])
        .find(
          (
            node,
          ): node is {
            name: string;
            url: string;
            provider: { name: string };
            isPartOf?: { url: string };
          } => (node as { "@type"?: string })["@type"] === "Course",
        );
      expect(course?.name, path).toBe(names.at(-1));
      expect(new URL(course?.url ?? "").pathname, path).toBe(path);
      expect(course?.provider.name, path).toBe(name);
      expect(
        course?.isPartOf === undefined ? null : new URL(course.isPartOf.url).pathname,
        path,
      ).toBe(partOf);

      // A large preview card drawn at /og plus the page's address.
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
    for (const path of ["/og/ai-roadmap/no-such-area", "/og/ai-roadmap/orbit-foundations/nope"]) {
      expect((await request.get(`${website.url}${path}`)).status(), path).toBe(404);
    }
  });

  test("a resource's address lands on the resource itself", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 700 });
    await page.goto(
      `${website.url}/ai-roadmap/orbit-foundations/signal-basics#resource-signal-book`,
    );
    const resource = page.locator("#resource-signal-book");
    await expect(resource).toContainText("A fictional book on signals");
    await expect(resource).toBeInViewport();
  });

  test("the chat's roadmap card and source lead to the module being learned", async ({ page }) => {
    await page.goto(`${website.url}/ask`);
    await hydrated(page);
    await page.getByRole("button", { name: `What is ${name} working on now?` }).click();
    const answer = page.getByRole("list", { name: "Conversation" }).locator(":scope > li").last();
    await expect(answer.locator("[aria-busy='false']")).toHaveCount(1);
    await expect(answer).toContainText("Signal basics is still being learned");

    const card = answer.getByRole("list", { name: "Cards" }).locator(":scope > li");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("AI Roadmap");
    await expect(card.getByRole("link", { name: "Signal basics" })).toHaveAttribute(
      "href",
      "/ai-roadmap/orbit-foundations/signal-basics",
    );
    const source = answer
      .getByRole("list", { name: "Sources", exact: true })
      .getByRole("link", { name: "Signal basics, AI Roadmap" });
    await expect(source).toHaveAttribute("href", "/ai-roadmap/orbit-foundations/signal-basics");
    await source.click();
    await expect(page).toHaveURL(/\/ai-roadmap\/orbit-foundations\/signal-basics$/u);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Signal basics");
  });

  test("the homepage's Exploring shows the learning in progress and leads to its pages", async ({
    page,
  }) => {
    await page.goto(website.url);
    const now = page.getByRole("region", { name: "Now", exact: true });
    await expect(now.getByRole("heading", { level: 3, name: "Exploring" })).toBeVisible();
    await expect(now.getByRole("link", { name: "Orbit foundations" })).toHaveAttribute(
      "href",
      "/ai-roadmap/orbit-foundations",
    );
    await expect(now).toContainText("1/4 resources completed");
    // Only what is in progress: the planned area and the untouched module are not listed.
    await expect(now).not.toContainText("Quiet systems");
    await expect(now).not.toContainText("Empty drawer");
    const modules = now.getByRole("list", { name: "Orbit foundations modules in progress" });
    await expect(modules.getByRole("link")).toHaveText(["Signal basics"]);

    await hydrated(page);
    await modules.getByRole("link", { name: "Signal basics" }).click();
    await expect(page).toHaveURL(/\/ai-roadmap\/orbit-foundations\/signal-basics$/u);
  });

  test("the area and module pages fit every width and mode, accessible and with large targets", async ({
    page,
  }) => {
    const pages = [
      { path: "/ai-roadmap/orbit-foundations", shot: "roadmap-area" },
      { path: "/ai-roadmap/orbit-foundations/signal-basics", shot: "roadmap-module" },
    ];
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const { path, shot } of pages) {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(`${website.url}${path}`);
        await hydrated(page);
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          await expectNoHorizontalScroll(page);
          await expectTouchTargets(page);
          await expectMarkersBesideNames(page, shot === "roadmap-module" ? "h3" : "h4");
          await page.screenshot({
            path: test.info().outputPath(`${shot}-${String(width)}-${scheme}.png`),
            fullPage: true,
          });
          if (width === 360 || width === 1280) await expectAccessible(page);
        }
      }
      // The homepage's Now with Exploring filled, at every width.
      await page.goto(website.url);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        const now = page.getByRole("region", { name: "Now", exact: true });
        await now.scrollIntoViewIfNeeded();
        await now.screenshot({
          path: test.info().outputPath(`homepage-now-${String(width)}-${scheme}.png`),
        });
      }
    }
  });

  test("a roadmap write reaches the warmed overview, detail pages and homepage within ten seconds", async () => {
    const overview = await text("/ai-roadmap");
    expect(overview).toContain("Quiet systems");
    expect(overview).toContain("A fictional queue guide");
    // Warm every page the writes below change.
    expect(await text("/ai-roadmap/quiet-systems")).toContain("Quiet systems");
    expect(await text("/ai-roadmap/quiet-systems/calm-queues")).toContain(
      "A fictional queue guide",
    );
    expect(await text("/")).not.toContain("Quiet systems");
    expect(await text("/ai-roadmap/quiet-systems/calm-queues")).not.toContain(">Current<");

    // A status change derives new current learning: the homepage's Exploring follows.
    await write("PATCH", "/v1/roadmap/resources/queue-guide", { status: "in-progress" });
    await expect.poll(() => text("/"), within).toContain("Quiet systems");
    await expect
      .poll(() => text("/ai-roadmap/quiet-systems/calm-queues"), within)
      .toContain(">Current<");

    await write("PATCH", "/v1/roadmap/areas/quiet-systems", { name: "Quieter systems" });
    for (const path of [
      "/ai-roadmap",
      "/ai-roadmap/quiet-systems",
      "/ai-roadmap/quiet-systems/calm-queues",
      "/",
    ]) {
      await expect
        .poll(() => text(path), { ...within, message: path })
        .toContain("Quieter systems");
    }

    await write("DELETE", "/v1/roadmap/resources/queue-guide");
    await expect.poll(() => text("/ai-roadmap"), within).not.toContain("A fictional queue guide");
    expect(await text("/ai-roadmap")).toContain("4 vetted resources");
    await expect
      .poll(() => text("/ai-roadmap/quiet-systems/calm-queues"), within)
      .toContain("No resources yet.");
    // Nothing in the area is in progress any more: it leaves the homepage's Exploring.
    await expect.poll(() => text("/"), within).not.toContain("Quieter systems");
  });

  test("moving a module to another area or a resource to another module reaches the overview and both pages", async ({
    page,
  }) => {
    /** The slug of the item that holds the given item on the rendered tree, or null. */
    async function parentOf(slug: string): Promise<string | null> {
      await page.goto(`${website.url}/ai-roadmap`);
      return page.evaluate((child) => {
        const own = document.querySelector(`[data-roadmap-slug="${child}"]`)?.closest("li");
        const parent = own?.parentElement?.closest("li");
        return (
          parent
            ?.querySelector<HTMLElement>(":scope > [data-roadmap-slug]")
            ?.getAttribute("data-roadmap-slug") ?? null
        );
      }, slug);
    }

    // Warm the old and the new addresses.
    expect(await status("/ai-roadmap/quiet-systems/calm-queues")).toBe(200);
    expect(await status("/ai-roadmap/orbit-foundations/calm-queues")).toBe(404);
    expect(await text("/ai-roadmap/orbit-foundations")).not.toContain("Calm queues");

    expect(await parentOf("calm-queues")).toBe("quiet-systems");
    await write("PATCH", "/v1/roadmap/modules/calm-queues", { area: "orbit-foundations" });
    await expect.poll(() => parentOf("calm-queues"), within).toBe("orbit-foundations");
    await expect.poll(() => status("/ai-roadmap/quiet-systems/calm-queues"), within).toBe(404);
    await expect.poll(() => status("/ai-roadmap/orbit-foundations/calm-queues"), within).toBe(200);
    await expect.poll(() => text("/ai-roadmap/orbit-foundations"), within).toContain("Calm queues");
    await expect.poll(() => text("/ai-roadmap/quiet-systems"), within).toContain("No modules yet.");

    const signals = "/ai-roadmap/orbit-foundations/signal-basics";
    const queues = "/ai-roadmap/orbit-foundations/calm-queues";
    expect(await text(signals)).toContain("A fictional book on signals");
    expect(await text(queues)).not.toContain("A fictional book on signals");

    expect(await parentOf("signal-book")).toBe("signal-basics");
    await write("PATCH", "/v1/roadmap/resources/signal-book", { module: "calm-queues" });
    await expect.poll(() => parentOf("signal-book"), within).toBe("calm-queues");
    await expect.poll(() => text(signals), within).not.toContain("A fictional book on signals");
    await expect.poll(() => text(queues), within).toContain("A fictional book on signals");
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
    for (const path of [
      "/ai-roadmap/orbit-foundations",
      "/ai-roadmap/orbit-foundations/signal-basics",
    ]) {
      const missing = await page.goto(path);
      expect(missing?.status(), path).toBe(404);
    }
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

  test("the overview and detail pages show the unavailable state, never not found; the static placeholders still load", async ({
    page,
  }) => {
    for (const path of [
      "/ai-roadmap",
      "/ai-roadmap/orbit-foundations",
      "/ai-roadmap/orbit-foundations/signal-basics",
    ]) {
      const response = await page.goto(`${website.url}${path}`);
      expect(response?.status(), path).toBe(500);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(unavailable);
    }
    await expectAccessible(page);
    for (const { path } of sections) {
      const placeholder = await page.goto(`${website.url}${path}`);
      expect(placeholder?.status(), path).toBe(200);
      await expect(subNavigation(page)).toBeVisible();
    }
  });
});
