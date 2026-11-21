// The assembled AI Roadmap against the fictional roadmap of e2e/fixtures/with-supporting-content/
// (Robin Ashby, the with-statistics tree, diary, book and events) with its supporting content: two
// project ideas (one whose Markdown tries to inject markup and a `javascript:` link, one without
// topics or advice), two followed sources (one with a safe link and unsafe Markdown, one without a
// link or description) and two additional terms. It covers the overview's supporting sections in
// the original's order, their disclosures by pointer and keyboard and their safe rendering; the
// static FAQ and the reading guide beside the bookshelf; the visitor journeys from the overview to
// a module, the diary to a day and the statistics, the bookshelf to a book and the reading guide,
// and the events to their day; the sub-navigation on every roadmap page and its absence elsewhere;
// the homepage's Exploring and its exact links; every roadmap page's title, canonical address on
// the configured origin, indexing, structured data and preview image; the sitemap and llms.txt;
// widths, themes, axe and touch targets; supporting-content writes reaching the warmed overview
// through the signed invalidation while the sitemap and llms.txt keep answering; the main stack's
// overview without supporting content and the unavailable state.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freePort, origin, required, startApi, startWebsite, type Started } from "./stack";

const scratch = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
const within = { timeout: 10_000, intervals: [250] };

// The canonical origin is a placeholder no test resolves: it only has to differ from the address
// the website listens on, so the metadata is seen to follow the setting.
const SITE = "https://site.example.test";
const name = "Robin Ashby";
const unavailable = "This page could not be loaded right now.";
const widths = [360, 768, 1280] as const;
const schemes = ["light", "dark"] as const;

const overview = "/ai-roadmap";
const area = "/ai-roadmap/orbit-foundations";
const modulePage = "/ai-roadmap/orbit-foundations/signal-basics";
const diary = "/ai-roadmap/diary";
const day = "/ai-roadmap/diary/2026-03-02";
const statistics = "/ai-roadmap/diary/stats";
const events = "/ai-roadmap/events";
const shelf = "/ai-roadmap/bookshelf";
const book = "/ai-roadmap/bookshelf/quiet-orbit-handbook";
const guide = "/ai-roadmap/how-to-read-effectively";

const roadmapCrumb = "AI Engineering Roadmap";

/** Every roadmap page with the way to it, as its breadcrumbs and title name it. */
const pages = [
  { path: overview, names: [roadmapCrumb], current: "Roadmap" },
  { path: area, names: [roadmapCrumb, "Orbit foundations"], current: "Roadmap" },
  {
    path: modulePage,
    names: [roadmapCrumb, "Orbit foundations", "Signal basics"],
    current: "Roadmap",
  },
  { path: diary, names: [roadmapCrumb, "Learning Diary"], current: "Learning Diary" },
  {
    path: day,
    names: [roadmapCrumb, "Learning Diary", "Monday, March 2, 2026"],
    current: "Learning Diary",
  },
  {
    path: statistics,
    names: [roadmapCrumb, "Learning Diary", "Learning Statistics"],
    current: "Learning Diary",
  },
  { path: events, names: [roadmapCrumb, "Events"], current: "Events" },
  { path: shelf, names: [roadmapCrumb, "Bookshelf"], current: "Bookshelf" },
  {
    path: book,
    names: [roadmapCrumb, "Bookshelf", "The Quiet Orbit Handbook"],
    current: "Bookshelf",
  },
  {
    path: guide,
    names: [roadmapCrumb, "Bookshelf", "How to Read Effectively"],
    current: "Bookshelf",
  },
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
// least 44 px tall (docs/design.md, Components).
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

async function hydrated(page: Page) {
  await page.waitForFunction(
    () => (window.history.state as { __NA?: boolean } | null)?.__NA === true,
  );
}

function subNavigation(page: Page) {
  return page.getByRole("navigation", { name: "AI Roadmap" });
}

/** A supporting section of the overview, by its heading. */
function section(page: Page, heading: string) {
  return page.getByRole("region", { name: heading, exact: true });
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

test.describe.configure({ mode: "serial" });

test.describe("the assembled AI Roadmap", () => {
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
    api = await startApi("with-supporting-content", {
      invalidation: {
        url: `${origin(required("WEB_HOST"), webPort)}/internal/invalidation`,
        secret,
      },
      keyFile,
    });
    key = (await readFile(keyFile, "utf8")).trim();
    website = await startWebsite(api.url, {
      port: webPort,
      invalidationSecret: secret,
      siteOrigin: SITE,
    });
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
    await response.body?.cancel();
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

  test("the overview ends with its supporting sections in the original's order", async ({
    page,
  }) => {
    await page.goto(`${website.url}${overview}`);
    const headings = await page.locator("main h2").allTextContents();
    expect(headings.slice(-4)).toEqual([
      "Portfolio Project Ideas",
      "Stay Current",
      "Frequently Asked Questions",
      "Additional Terms to Explore",
    ]);

    // Project ideas: numbered in the API's order, closed until opened.
    const ideas = section(page, "Portfolio Project Ideas");
    const ideaTriggers = ideas.getByRole("button");
    await expect(ideaTriggers).toHaveText([
      /^1\.\s*A question desk over fictional orbit notes$/u,
      /^2\.\s*A calm queue agent with one tool$/u,
    ]);
    for (const trigger of await ideaTriggers.all()) {
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
    }

    // Followed sources: a safe link opens in a new tab; a source without one is plain text.
    const sources = section(page, "Stay Current");
    await expect(sources.getByRole("heading", { level: 3 })).toHaveText([
      "Orbit Weekly (opens in a new tab)",
      "The Testville study circle",
    ]);
    const weekly = sources.getByRole("link", { name: "Orbit Weekly (opens in a new tab)" });
    await expect(weekly).toHaveAttribute("href", "https://example.com/orbit-weekly");
    await expect(weekly).toHaveAttribute("target", "_blank");
    await expect(weekly).toHaveAttribute("rel", "noopener noreferrer");
    await expect(sources).toContainText("newsletter");
    await expect(sources).toContainText("community");
    await expect(sources.locator("em")).toHaveText(["fictional"]);

    // The FAQ is the site's own text: six questions, the first open.
    const faq = section(page, "Frequently Asked Questions");
    const questions = faq.getByRole("button");
    await expect(questions).toHaveCount(6);
    await expect(questions.first()).toHaveText("What is the AI Engineering Roadmap?");
    await expect(questions.first()).toHaveAttribute("aria-expanded", "true");
    await expect(faq).toContainText("A structured, public learning roadmap");
    await expect(questions.nth(1)).toHaveAttribute("aria-expanded", "false");

    // Additional terms: one disclosure over every term.
    const terms = section(page, "Additional Terms to Explore");
    const browse = terms.getByRole("button", { name: "Browse terms" });
    await expect(browse).toHaveAttribute("aria-expanded", "false");
    await hydrated(page);
    await browse.click();
    await expect(browse).toHaveAttribute("aria-expanded", "true");
    await expect(terms.locator("dt")).toHaveText(["Signal window", "Quiet grounding"]);
    await expect(terms.locator("dd strong")).toHaveText(["ticks"]);
  });

  test("the keyboard opens and closes a project idea and a question", async ({ page }) => {
    await page.goto(`${website.url}${overview}`);
    await hydrated(page);
    const ideas = section(page, "Portfolio Project Ideas");
    const first = ideas.getByRole("button", { name: /A question desk/u });
    for (let step = 0; step < 80; step += 1) {
      await page.keyboard.press("Tab");
      if (await first.evaluate((element) => element === document.activeElement)) break;
    }
    await expect(first).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(first).toHaveAttribute("aria-expanded", "true");
    const [firstIdea, secondIdea] = await ideas.locator(":scope > ol > li").all();
    if (firstIdea === undefined || secondIdea === undefined) throw new Error("two ideas expected");
    await expect(firstIdea.getByText("Why it matters")).toBeVisible();
    await expect(firstIdea.locator("ul > li")).toHaveText(["Retrieval", "Evaluation"]);
    await expect(firstIdea.getByText("How to start")).toBeVisible();
    await expect(firstIdea.locator("ol > li")).toHaveText([
      "Collect a few fictional notes.",
      "Index them with keyword search first.",
    ]);
    await page.keyboard.press("Space");
    await expect(first).toHaveAttribute("aria-expanded", "false");

    // The idea without topics or advice shows neither heading.
    const second = ideas.getByRole("button", { name: /A calm queue agent/u });
    await page.keyboard.press("Tab");
    await expect(second).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(second).toHaveAttribute("aria-expanded", "true");
    await expect(secondIdea.getByText("One tool is enough")).toBeVisible();
    await expect(secondIdea.getByText("Key topics")).toHaveCount(0);
    await expect(secondIdea.getByText("How to start")).toHaveCount(0);

    const question = section(page, "Frequently Asked Questions").getByRole("button", {
      name: "Who is this roadmap for?",
    });
    await question.focus();
    await page.keyboard.press("Enter");
    await expect(question).toHaveAttribute("aria-expanded", "true");
  });

  test("renders supporting content as text: no script, image, raw markup or javascript: link", async ({
    page,
  }) => {
    await page.goto(`${website.url}${overview}`);
    await hydrated(page);
    await section(page, "Portfolio Project Ideas")
      .getByRole("button", { name: /A question desk/u })
      .click();
    const supporting = page.locator(
      'section[aria-labelledby="project-ideas-heading"], section[aria-labelledby="stay-current-heading"]',
    );
    await expect(supporting.first()).toContainText("trap link");
    await expect(supporting.locator("script, img, b, iframe")).toHaveCount(0);
    await expect(page.locator('main a[href^="javascript:"]')).toHaveCount(0);
    expect(await page.evaluate(() => "__supportInjected" in window)).toBe(false);
    await page.setViewportSize({ width: 360, height: 800 });
    await expectNoHorizontalScroll(page);
  });

  test("the reading guide sits beside the bookshelf with its source and its way back", async ({
    page,
  }) => {
    const response = await page.goto(`${website.url}${guide}`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(
      `How to Read Effectively — Bookshelf — AI Engineering Roadmap — ${name}`,
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("How to Read Effectively");
    await expect(subNavigation(page).locator('[aria-current="page"]')).toHaveText("Bookshelf");
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("listitem"),
    ).toHaveText([roadmapCrumb, "Bookshelf", "How to Read Effectively"]);
    await expect(page.locator("main h2")).toHaveText([
      "1. Consumption period",
      "2. Digestion period",
      "PACER",
      "Keep the two periods in balance",
    ]);
    await expect(page.locator("main h3")).toHaveText([
      "P — Procedural",
      "A — Analogous",
      "C — Conceptual",
      "E — Evidence",
      "R — Reference",
    ]);
    const source = page.getByRole("link", {
      name: "How to Remember Everything You Read (opens in a new tab)",
    });
    await expect(source).toHaveAttribute("target", "_blank");
    await expect(source).toHaveAttribute("rel", "noopener noreferrer");
    expect(new URL((await source.getAttribute("href")) ?? "").protocol).toBe("https:");

    // From the bookshelf by keyboard, and back by the breadcrumbs.
    await page.goto(`${website.url}${shelf}`);
    await hydrated(page);
    const toGuide = page.getByRole("link", { name: /How to read effectively/u });
    await expect(toGuide).toHaveAttribute("href", guide);
    await toGuide.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${website.url}${guide}`);
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Bookshelf" })
      .click();
    await expect(page).toHaveURL(`${website.url}${shelf}`);
  });

  test("a visitor goes from the overview to a module, the diary to a day and the statistics, the bookshelf to a book and the events to their day", async ({
    page,
  }) => {
    await page.goto(`${website.url}${overview}`);
    await hydrated(page);
    await page.getByRole("button", { name: /^Orbit foundations/u }).click();
    await page.getByRole("link", { name: "Open the area page: Orbit foundations" }).click();
    await expect(page).toHaveURL(`${website.url}${area}`);
    await page.getByRole("button", { name: /^Signal basics/u }).click();
    await page.getByRole("link", { name: "Open the module page: Signal basics" }).click();
    await expect(page).toHaveURL(`${website.url}${modulePage}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Signal basics");

    await subNavigation(page).getByRole("link", { name: "Learning Diary" }).click();
    await expect(page).toHaveURL(`${website.url}${diary}`);
    await page.getByRole("link", { name: "Monday, March 2, 2026" }).click();
    await expect(page).toHaveURL(`${website.url}${day}`);
    await page.getByRole("link", { name: /View statistics/u }).click();
    await expect(page).toHaveURL(`${website.url}${statistics}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Learning Statistics");

    await subNavigation(page).getByRole("link", { name: "Bookshelf" }).click();
    await expect(page).toHaveURL(`${website.url}${shelf}`);
    await page.getByRole("link", { name: "The Quiet Orbit Handbook" }).click();
    await expect(page).toHaveURL(`${website.url}${book}`);

    await subNavigation(page).getByRole("link", { name: "Events" }).click();
    await expect(page).toHaveURL(`${website.url}${events}`);
    await page.getByRole("link", { name: "In the learning diary: Spring orbit meetup" }).click();
    await expect(page).toHaveURL(`${website.url}/ai-roadmap/diary/2026-03-03`);
    await expect(page.getByRole("heading", { level: 2, name: "Events" })).toBeVisible();
  });

  test("the sub-navigation shows on every roadmap page, marks its section and nowhere else", async ({
    page,
  }) => {
    for (const { path, current } of pages) {
      const response = await page.goto(`${website.url}${path}`);
      expect(response?.status(), path).toBe(200);
      const nav = subNavigation(page);
      await expect(nav.getByRole("link"), path).toHaveText([
        "AI Engineering Roadmap",
        "Roadmap",
        "Learning Diary",
        "Bookshelf",
        "Events",
      ]);
      await expect(nav.locator('[aria-current="page"]'), path).toHaveText(current);
    }
    for (const path of ["/", "/experience", "/services", "/cv", "/ask", "/missing-page"]) {
      await page.goto(`${website.url}${path}`);
      await expect(subNavigation(page), path).toHaveCount(0);
    }
  });

  test("the homepage's Exploring leads to the learning in progress at its exact pages", async ({
    page,
  }) => {
    await page.goto(website.url);
    const now = page.getByRole("region", { name: "Now", exact: true });
    await expect(now.getByRole("heading", { level: 3, name: "Exploring" })).toBeVisible();
    // Each area and module in progress links to its own nested page, never to the overview.
    const links = now.locator('h3:text-is("Exploring") + ul a');
    const hrefs = await links.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("href") ?? ""),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/ai-roadmap\/[a-z0-9-]+(?:\/[a-z0-9-]+)?$/u);
      expect(await status(href), href).toBe(200);
    }
    await hydrated(page);
    const first = links.first();
    const label = (await first.textContent()) ?? "";
    await first.click();
    await expect(page).toHaveURL(`${website.url}${hrefs[0] ?? ""}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(label);
  });

  test("every roadmap page has its title, canonical address, structured data and preview, open to search engines", async ({
    page,
    request,
  }) => {
    for (const { path, names } of pages) {
      await page.goto(`${website.url}${path}`);
      const title = [...names].reverse().join(" — ") + ` — ${name}`;
      await expect(page, path).toHaveTitle(title);
      const canonical = `${SITE}${path}`;
      await expect(page.locator('link[rel="canonical"]'), path).toHaveAttribute("href", canonical);
      await expect(page.locator('meta[property="og:url"]'), path).toHaveAttribute(
        "content",
        canonical,
      );
      await expect(page.locator('meta[name="robots"]'), path).toHaveCount(0);
      const description = await page.locator('meta[name="description"]').getAttribute("content");
      expect(description?.length ?? 0, path).toBeGreaterThan(0);
      // Plain text: Markdown syntax never reaches the description.
      expect(description, path).not.toMatch(/[*_[\]]/u);

      const nodes = await graphNodes(page);
      const webPage = nodes.find((node) => node["@type"] === "WebPage");
      expect(webPage?.["url"], path).toBe(canonical);
      const crumbs = nodes.find((node) => node["@type"] === "BreadcrumbList") as
        { itemListElement: { name: string; item: string }[] } | undefined;
      expect(
        crumbs?.itemListElement.map((item) => item.name),
        path,
      ).toEqual([...names]);
      expect(crumbs?.itemListElement.at(-1)?.item, path).toBe(canonical);

      await expect(page.locator('meta[name="twitter:card"]'), path).toHaveAttribute(
        "content",
        "summary_large_image",
      );
      const image = await page.locator('meta[property="og:image"]').getAttribute("content");
      expect(new URL(image ?? "").pathname, path).toBe(`/og${path}`);
      const preview = await request.get(`${website.url}/og${path}`);
      expect(preview.status(), path).toBe(200);
      expect(preview.headers()["content-type"], path).toBe("image/png");
      // The CDN keeps a preview as briefly as the pages (infra/README.md, CDN caching).
      expect(preview.headers()["cache-control"], path).toBe(
        "public, max-age=0, s-maxage=60, stale-while-revalidate=60, stale-if-error=86400",
      );
    }

    // The reading guide is the person's article, based on the talk it summarises.
    await page.goto(`${website.url}${guide}`);
    const article = (await graphNodes(page)).find((node) => node["@type"] === "Article") as
      { author: { name: string }; isBasedOn: { name: string } } | undefined;
    expect(article?.author.name).toBe(name);
    expect(article?.isBasedOn.name).toBe("How to Remember Everything You Read");

    for (const path of ["/og/ai-roadmap/diary/2026-01-01", "/og/ai-roadmap/no-such-area"]) {
      expect((await request.get(`${website.url}${path}`)).status(), path).toBe(404);
    }
  });

  test("the sitemap and llms.txt list every roadmap page, each one answering", async ({
    request,
  }) => {
    const xml = await (await request.get(`${website.url}/sitemap.xml`)).text();
    const locations = [...xml.matchAll(/<loc>([^<]*)<\/loc>/gu)].map((match) => match[1] ?? "");
    for (const { path } of pages) expect(locations, path).toContain(`${SITE}${path}`);
    for (const location of locations) {
      const path = location.slice(SITE.length);
      expect(await status(path), path).toBe(200);
    }

    const llms = await (await request.get(`${website.url}/llms.txt`)).text();
    // The diary's days are left to the sitemap: their titles are only dates.
    for (const { path } of pages) {
      if (path === day) expect(llms).not.toContain(`(${SITE}${path})`);
      else expect(llms, path).toContain(`(${SITE}${path})`);
    }
    // Supporting content has no pages of its own, so it is never listed.
    expect(llms).not.toContain("Orbit Weekly");
  });

  test("fits every width and mode, accessible and with large targets", async ({ page }) => {
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [label, path] of [
        ["overview", overview],
        ["reading-guide", guide],
      ] as const) {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(`${website.url}${path}`);
        if (path === overview) {
          await hydrated(page);
          await section(page, "Portfolio Project Ideas")
            .getByRole("button", { name: /A question desk/u })
            .click();
          await section(page, "Additional Terms to Explore")
            .getByRole("button", { name: "Browse terms" })
            .click();
        }
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          await expectNoHorizontalScroll(page);
          await expectTouchTargets(page);
          await page.screenshot({
            path: test.info().outputPath(`supporting-${label}-${String(width)}-${scheme}.png`),
            fullPage: true,
          });
          if (width === 360 || width === 1280) await expectAccessible(page);
        }
      }
    }
  });

  test("supporting-content writes reach the warmed overview while the sitemap and llms.txt keep answering", async () => {
    // Warm the overview and the discovery outputs.
    expect(await text(overview)).toContain("A question desk over fictional orbit notes");
    expect(await text("/sitemap.xml")).toContain(`${SITE}${guide}`);
    expect(await text("/llms.txt")).toContain(`(${SITE}${guide})`);

    await write("PATCH", "/v1/roadmap/project-ideas/orbit-question-desk", {
      title: "A rewritten orbit question desk",
    });
    await expect.poll(() => text(overview), within).toContain("A rewritten orbit question desk");

    await write("POST", "/v1/roadmap/glossary-terms", {
      slug: "calm-drift",
      term: "Calm drift",
      description: "A fictional term added after the overview was warmed.",
      position: 2,
    });
    await expect.poll(() => text(overview), within).toContain("Calm drift");

    await write("DELETE", "/v1/roadmap/followed-sources/orbit-weekly");
    await expect.poll(() => text(overview), within).not.toContain("Orbit Weekly");
    expect(await text(overview)).toContain("The Testville study circle");

    // Deleting every project idea takes its section away; the FAQ stays.
    await write("DELETE", "/v1/roadmap/project-ideas/orbit-question-desk");
    await write("DELETE", "/v1/roadmap/project-ideas/calm-queue-agent");
    await expect.poll(() => text(overview), within).not.toContain("Portfolio Project Ideas");
    expect(await text(overview)).toContain("Frequently Asked Questions");

    // The discovery outputs list pages, not supporting content: they still answer in full.
    for (const path of ["/sitemap.xml", "/llms.txt"]) expect(await status(path), path).toBe(200);
    expect(await text("/sitemap.xml")).toContain(`${SITE}${guide}`);
    expect(await text("/llms.txt")).toContain(`(${SITE}${overview})`);
  });
});

test.describe("an overview without supporting content", () => {
  // The main stack's fixture (with-photo) has a profile and no roadmap content at all.
  test("shows only the FAQ among the supporting sections, and the reading guide still answers", async ({
    page,
  }) => {
    const response = await page.goto(overview);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 2, name: "Frequently Asked Questions" }),
    ).toBeVisible();
    for (const heading of [
      "Portfolio Project Ideas",
      "Stay Current",
      "Additional Terms to Explore",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name: heading })).toHaveCount(0);
    }
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 360, height: 800 });
      await page.screenshot({
        path: test.info().outputPath(`supporting-empty-360-${scheme}.png`),
        fullPage: true,
      });
    }
    await expectAccessible(page);
    expect((await page.goto(guide))?.status()).toBe(200);
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

  test("the overview and the reading guide show the unavailable state, never empty sections", async ({
    page,
  }) => {
    for (const path of [overview, guide]) {
      const response = await page.goto(`${website.url}${path}`);
      expect(response?.status(), path).toBe(500);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(unavailable);
      await expect(page.getByRole("heading", { name: "Frequently Asked Questions" })).toHaveCount(
        0,
      );
    }
    await expectAccessible(page);
  });
});
