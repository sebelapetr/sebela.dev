import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freePort, origin, required, startApi, startWebsite, type Started } from "./stack";

// Fixture values (e2e/fixtures/*/person.json): fictional people that exist only for these tests.
// The canonical origin is a placeholder no test resolves: it only has to differ from the address
// the website listens on, so the outputs are seen to follow the setting.
const SITE = "https://site.example.test";
const withExperience = {
  name: "Casey Morrow",
  headline: "Fictional engineer who builds calm software for logistics and health care",
};
const withUnsafeText = {
  name: "Avery </script> Quill",
  headline: "Fictional engineer </script><script>window.__injected = true</script> & <b>tests</b>",
};

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

type Node = Record<string, unknown>;

async function structuredData(page: Page): Promise<Node[]> {
  const scripts = page.locator('script[type="application/ld+json"]');
  await expect(scripts).toHaveCount(1);
  const parsed = JSON.parse((await scripts.textContent()) ?? "") as { "@graph": Node[] };
  return parsed["@graph"];
}

async function screenshots(page: Page, name: string, outputPath: (file: string) => string) {
  for (const scheme of schemes) {
    await page.emulateMedia({ colorScheme: scheme });
    // Load again, so no colour transition is caught half-way.
    await page.reload();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalScroll(page);
      await page.screenshot({
        path: outputPath(`${name}-${String(width)}-${scheme}.png`),
        fullPage: true,
      });
    }
    await expectAccessible(page);
  }
}

test.describe("metadata and indexing files on the configured origin", () => {
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

  for (const [path, title] of [
    ["/", `${withExperience.name} — ${withExperience.headline}`],
    ["/experience", `Experience — ${withExperience.name}`],
    ["/services", `Services — ${withExperience.name}`],
    ["/cv", `CV — ${withExperience.name}`],
  ] as const) {
    test(`${path} has its title, description and canonical address`, async ({ page }) => {
      const response = await page.goto(`${website.url}${path}`);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(title);
      const canonical = `${SITE}${path}`;
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical);
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", canonical);
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", title);
      await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
        "content",
        withExperience.name,
      );
      const description = await page.locator('meta[name="description"]').getAttribute("content");
      expect(description?.length ?? 0).toBeGreaterThan(0);
      // Plain text: Markdown syntax from the profile never reaches the description.
      expect(description).not.toMatch(/[*_[\]]/);
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    });
  }

  test("the homepage describes the site, the profile page and the person", async ({ page }) => {
    await page.goto(website.url);
    const graph = await structuredData(page);
    expect(graph.map((node) => node["@type"])).toEqual(["WebSite", "ProfilePage", "Person"]);
    expect(graph[2]).toMatchObject({
      "@id": `${SITE}/#person`,
      name: withExperience.name,
      description: withExperience.headline,
      url: `${SITE}/`,
    });
  });

  test("the other pages carry no structured data of the person", async ({ page }) => {
    for (const path of ["/experience", "/services", "/cv"]) {
      await page.goto(`${website.url}${path}`);
      await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
    }
  });

  test("the sitemap lists the real pages on the configured origin", async ({ request }) => {
    const response = await request.get(`${website.url}/sitemap.xml`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/xml; charset=utf-8");
    const xml = await response.text();
    const locations = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
    expect(locations).toEqual([`${SITE}/`, `${SITE}/experience`, `${SITE}/services`, `${SITE}/cv`]);
    for (const location of locations) {
      const path = (location ?? "").slice(SITE.length);
      expect((await request.get(`${website.url}${path}`)).status()).toBe(200);
    }
  });

  test("robots.txt lets crawlers in and points at the sitemap", async ({ request }) => {
    const response = await request.get(`${website.url}/robots.txt`);
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
  });

  test("llms.txt summarises the profile with links on the configured origin", async ({
    request,
  }) => {
    const response = await request.get(`${website.url}/llms.txt`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("text/plain; charset=utf-8");
    const text = await response.text();
    expect(text.startsWith(`# ${withExperience.name}\n\n> ${withExperience.headline}\n`)).toBe(
      true,
    );
    expect(text).toContain(`- [Home](${SITE}/)`);
    expect(text).toContain(`- [CV (PDF)](${SITE}/cv/pdf)`);
    expect(text).toContain(`(${SITE}/experience#experience-fernway-lead-engineer)`);
    expect(text).toContain(`(${SITE}/services#service-process-automation)`);
    expect(text).toContain(`(${SITE}/experience#exploration-answer-checker)`);
    expect(text).not.toMatch(/\/ask|\/ai-roadmap|\?c=/);
    expect(text).not.toContain(website.url);
  });

  test("every anchor llms.txt links to exists on its page", async ({ page, request }) => {
    const text = await (await request.get(`${website.url}/llms.txt`)).text();
    const anchors = [...text.matchAll(/\]\(https:\/\/site\.example\.test(\/[a-z]+)#([^)]+)\)/g)];
    expect(anchors.length).toBeGreaterThan(0);
    for (const [, path, id] of anchors) {
      await page.goto(`${website.url}${path ?? ""}`);
      await expect(page.locator(`[id="${id ?? ""}"]`)).toHaveCount(1);
    }
  });
});

test.describe("metadata of a profile with unsafe text", () => {
  let api: Started;
  let website: Started;

  test.beforeAll(async () => {
    api = await startApi("with-unsafe-text");
    website = await startWebsite(api.url);
  });

  test.afterAll(async () => {
    await website.stop();
    await api.stop();
  });

  test("keeps the text as text in the title and the structured data", async ({ page }) => {
    await page.goto(website.url);
    await expect(page).toHaveTitle(`${withUnsafeText.name} — ${withUnsafeText.headline}`);
    expect(await page.evaluate(() => "__injected" in window)).toBe(false);
    await expect(page.locator("head script:not([src])", { hasText: "__injected" })).toHaveCount(0);
    const graph = await structuredData(page);
    expect(graph[2]).toMatchObject({
      name: withUnsafeText.name,
      description: withUnsafeText.headline,
    });
  });

  test("keeps llms.txt's structure", async ({ request }) => {
    const text = await (await request.get(`${website.url}/llms.txt`)).text();
    // Every bracket the text brings is escaped, so none of them closes a link to the other site.
    expect(text).not.toMatch(/[^\\]\]\(https:\/\/evil/);
    expect(text).toContain(
      "- [Notes \\](https://evil.example.test) \\[](https://quill.example.test/notes)",
    );
  });

  test(`fits every width in both modes without violations`, async ({ page }, testInfo) => {
    await page.goto(website.url);
    await screenshots(page, "unsafe-text", (file) => testInfo.outputPath(file));
  });
});

test.describe("metadata without a published profile", () => {
  let api: Started;
  let website: Started;

  test.beforeAll(async () => {
    api = await startApi("without-profile");
    website = await startWebsite(api.url);
  });

  test.afterAll(async () => {
    await website.stop();
    await api.stop();
  });

  test("the homepage is not found and not indexed", async ({ page }) => {
    const response = await page.goto(website.url);
    expect(response?.status()).toBe(404);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  });

  test("the sitemap and llms.txt are not found, robots.txt still answers", async ({ request }) => {
    for (const path of ["/sitemap.xml", "/llms.txt"]) {
      const response = await request.get(`${website.url}${path}`);
      expect(response.status()).toBe(404);
      expect(response.headers()["x-robots-tag"]).toBe("noindex");
    }
    expect((await request.get(`${website.url}/robots.txt`)).status()).toBe(200);
  });
});

test.describe("metadata while the API is unavailable", () => {
  let website: Started;

  test.beforeAll(async () => {
    // An address nothing listens on: the port was free a moment ago.
    const host = required("API_HOST");
    website = await startWebsite(origin(host, await freePort(host)));
  });

  test.afterAll(async () => {
    await website.stop();
  });

  test("the page says it is unavailable and asks not to be indexed", async ({ page }, testInfo) => {
    const response = await page.goto(website.url);
    expect(response?.status()).toBe(500);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
    await screenshots(page, "unavailable-noindex", (file) => testInfo.outputPath(file));
  });

  test("the sitemap and llms.txt answer 503, never an empty success", async ({ request }) => {
    for (const path of ["/sitemap.xml", "/llms.txt"]) {
      const response = await request.get(`${website.url}${path}`);
      expect(response.status()).toBe(503);
      expect(response.headers()["retry-after"]).toBe("60");
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(await response.text()).not.toContain("<loc>");
    }
    const robots = await request.get(`${website.url}/robots.txt`);
    expect(robots.status()).toBe(200);
  });
});
