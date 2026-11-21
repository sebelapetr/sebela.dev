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
    ["/", `${withExperience.name} · Fictional engineer who builds calm software…`],
    ["/experience", `Experience · ${withExperience.name}`],
    ["/services", `Services · ${withExperience.name}`],
    ["/cv", `CV · ${withExperience.name}`],
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
      // Short enough for a search result to show whole, and the page points AI readers to llms.txt.
      expect(Array.from(await page.title()).length).toBeLessThanOrEqual(60);
      await expect(page.locator('link[rel="alternate"][type="text/plain"]')).toHaveAttribute(
        "href",
        "/llms.txt",
      );
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
      // The current main job and own business, never the ended roles or the side project.
      jobTitle: ["Lead engineer", "Independent consultant"],
      worksFor: [
        {
          "@type": "Organization",
          name: "Fernway Logistics",
          url: "https://fernway.example.test/",
        },
        { "@type": "Organization", name: "Morrow Studio" },
      ],
      knowsAbout: expect.arrayContaining(["TypeScript", "PostgreSQL"]),
    });
    expect(graph[2]).not.toHaveProperty("worksFor.1.url");
  });

  test("the experience page lists the roles and describes the person", async ({ page }) => {
    await page.goto(`${website.url}/experience`);
    const graph = await structuredData(page);
    expect(graph.map((node) => node["@type"])).toEqual(["WebPage", "Person", "ItemList"]);
    expect(graph[0]).toMatchObject({
      "@id": `${SITE}/experience#webpage`,
      about: { "@id": `${SITE}/#person` },
      mainEntity: { "@id": `${SITE}/experience#experiences` },
    });
    expect(graph[1]).toMatchObject({
      "@id": `${SITE}/#person`,
      jobTitle: ["Lead engineer", "Independent consultant"],
      knowsAbout: expect.arrayContaining(["TypeScript"]),
    });
    expect(graph[2]).toMatchObject({
      itemListElement: expect.arrayContaining([
        expect.objectContaining({
          name: "Lead engineer at Fernway Logistics",
          url: `${SITE}/experience#experience-fernway-lead-engineer`,
        }),
      ]),
    });
  });

  test("the services page lists the services the person provides", async ({ page }) => {
    await page.goto(`${website.url}/services`);
    const graph = await structuredData(page);
    expect(graph.map((node) => node["@type"])).toEqual(["WebPage", "Person", "ItemList"]);
    const services = (graph[2] as { itemListElement: { item: Node }[] }).itemListElement.map(
      (element) => element.item,
    );
    expect(services.length).toBeGreaterThan(0);
    for (const service of services) {
      expect(service).toMatchObject({ "@type": "Service", provider: { "@id": `${SITE}/#person` } });
    }
  });

  test("the CV page is a profile page of the person with the skills", async ({ page }) => {
    await page.goto(`${website.url}/cv`);
    const graph = await structuredData(page);
    expect(graph.map((node) => node["@type"])).toEqual(["ProfilePage", "Person"]);
    expect(graph[0]).toMatchObject({
      "@id": `${SITE}/cv#webpage`,
      mainEntity: { "@id": `${SITE}/#person` },
    });
    expect(graph[1]).toMatchObject({
      jobTitle: ["Lead engineer", "Independent consultant"],
      knowsAbout: expect.arrayContaining(["TypeScript"]),
    });
  });

  test("the sitemap lists the real pages on the configured origin", async ({ request }) => {
    const response = await request.get(`${website.url}/sitemap.xml`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/xml; charset=utf-8");
    const xml = await response.text();
    const locations = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
    // The profile's pages, then the AI Roadmap's own pages; this fixture has no areas, days or books.
    expect(locations).toEqual([
      `${SITE}/`,
      `${SITE}/experience`,
      `${SITE}/services`,
      `${SITE}/cv`,
      `${SITE}/ai-roadmap`,
      `${SITE}/ai-roadmap/diary`,
      `${SITE}/ai-roadmap/diary/stats`,
      `${SITE}/ai-roadmap/events`,
      `${SITE}/ai-roadmap/bookshelf`,
      `${SITE}/ai-roadmap/how-to-read-effectively`,
    ]);
    for (const location of locations) {
      const path = (location ?? "").slice(SITE.length);
      expect((await request.get(`${website.url}${path}`)).status()).toBe(200);
    }
  });

  test("documents and previews may be kept briefly by the CDN, pages and Ask never by the website", async ({
    request,
  }) => {
    const rule = "public, max-age=0, s-maxage=60, stale-while-revalidate=60, stale-if-error=86400";
    for (const path of ["/robots.txt", "/llms.txt", "/sitemap.xml", "/og/home"]) {
      const response = await request.get(`${website.url}${path}`);
      expect({ path, status: response.status() }).toEqual({ path, status: 200 });
      expect({ path, value: response.headers()["cache-control"] }).toEqual({ path, value: rule });
    }
    // Pages get the public rule from the reverse proxy only (infra/nginx), which sees the upstream
    // status and the navigation header; the website itself never marks a page public.
    for (const path of ["/", "/experience", "/ai-roadmap", "/ask"]) {
      const response = await request.get(`${website.url}${path}`);
      expect({ path, value: response.headers()["cache-control"] }).toEqual({
        path,
        value: expect.stringMatching(/\bno-store\b/u),
      });
    }
    // A client navigation's payload and the health check.
    const payload = await request.get(`${website.url}/experience`, { headers: { RSC: "1" } });
    expect(payload.headers()["cache-control"]).toMatch(/\bno-store\b/u);
    expect((await request.get(`${website.url}/health`)).headers()["cache-control"]).toBe(
      "no-store",
    );
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
    expect(text).toContain(`- [AI Engineering Roadmap](${SITE}/ai-roadmap)`);
    expect(text).toContain(
      `- [How to Read Effectively](${SITE}/ai-roadmap/how-to-read-effectively)`,
    );
    expect(text).not.toMatch(/\/ask|\?c=/);
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
    await expect(page).toHaveTitle(`${withUnsafeText.name} · Fictional engineer…`);
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
    // Never kept by the CDN, so the profile shows as soon as it is published.
    expect(response?.headers()["cache-control"]).toMatch(/\bno-store\b/u);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  });

  test("the sitemap and llms.txt are not found, robots.txt still answers", async ({ request }) => {
    for (const path of ["/sitemap.xml", "/llms.txt"]) {
      const response = await request.get(`${website.url}${path}`);
      expect(response.status()).toBe(404);
      expect(response.headers()["x-robots-tag"]).toBe("noindex");
      expect(response.headers()["cache-control"]).toBe("no-store");
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

test.describe("a site not switched to indexing", () => {
  let api: Started;
  let website: Started;

  test.beforeAll(async () => {
    api = await startApi("with-experience");
    // As in a worktree or a production stack before launch: `WEB_INDEXING` unset.
    website = await startWebsite(api.url, { siteOrigin: SITE, indexing: false });
  });

  test.afterAll(async () => {
    await website.stop();
    await api.stop();
  });

  test("every page asks search engines not to index it, in its header and its meta tag", async ({
    page,
  }) => {
    for (const path of ["/", "/experience", "/services", "/cv"]) {
      const response = await page.goto(`${website.url}${path}`);
      expect(response?.status(), path).toBe(200);
      expect(response?.headers()["x-robots-tag"], path).toBe("noindex, nofollow");
      await expect(page.locator('meta[name="robots"]'), path).toHaveAttribute(
        "content",
        "noindex, nofollow",
      );
    }
  });

  test("the indexing files say noindex too, and robots.txt stays readable", async ({ request }) => {
    for (const path of ["/robots.txt", "/sitemap.xml", "/llms.txt"]) {
      const response = await request.get(`${website.url}${path}`);
      expect(response.status(), path).toBe(200);
      expect(response.headers()["x-robots-tag"], path).toMatch(/noindex/);
    }
  });
});
