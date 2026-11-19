import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { startApi, startWebsite, type Started } from "./stack";

// Fixture values (e2e/fixtures/with-experience/): a fictional career that exists only for these
// tests. Two current-focus entries (one on the route planner, one with its own web link), one
// ongoing exploration (Tool scopes, designed only) beside two finished ones, two current roles and
// three services, and no AI Roadmap, so Now has no Exploring column.
const workingOn = [
  {
    title: "Taking the route planner to every depot",
    topic: "Routing",
    link: "View the project: Taking the route planner to every depot",
    href: "/experience#project-route-planner",
  },
  {
    title: "An answer checker as a small library",
    topic: "Evaluation",
    link: "Read more: An answer checker as a small library",
    href: "https://notes.example.test/answer-checker",
  },
] as const;

const services = [
  { name: "Process automation", href: "/services#service-process-automation" },
  { name: "Custom software", href: "/services#service-custom-software" },
  { name: "AI integration", href: "/services#service-ai-integration" },
] as const;

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

// Every link and button outside running text is at least 44 px tall (docs/design.md, Components).
async function expectTouchTargets(page: Page) {
  const heights = await page
    .locator("main a:not(p a), main button, footer a")
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.checkVisibility())
        .map((element) => element.getBoundingClientRect().height),
    );
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
}

/** Waits until the page is hydrated: Next's router then marks its history entry. */
async function hydrated(page: Page) {
  await page.waitForFunction(
    () => (window.history.state as { __NA?: boolean } | null)?.__NA === true,
  );
}

function region(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

test.describe("the homepage's narrative read from the API", () => {
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

  test("keeps the sections in the PRD's order", async ({ page }) => {
    await page.goto(website.url);
    const order = await page
      .locator("main > section")
      .evaluateAll((sections) =>
        sections.map((element) => element.getAttribute("aria-labelledby")),
      );
    expect(order).toEqual([
      "hero-heading",
      "what-i-do-heading",
      "selected-work-heading",
      "experience-snapshot-heading",
      "now-heading",
      "services-summary-heading",
      "contact-heading",
    ]);
    await expect(page.getByRole("contentinfo")).toBeVisible();
  });

  test("says what kinds of work the person does, one sentence each", async ({ page }) => {
    await page.goto(website.url);
    const section = region(page, "What I do");
    await expect(section.getByRole("heading", { level: 3 })).toHaveText([
      "Software systems",
      "Integrations & automation",
      "AI engineering",
    ]);
    await expect(section.getByRole("listitem")).toHaveCount(3);
  });

  test("sums up the experience with the current roles, two technology lines and the CV", async ({
    page,
  }) => {
    await page.goto(website.url);
    const section = region(page, "Experience");
    await expect(section).toContainText(/\d+ years of professional software development\./u);
    await expect(section).toContainText("Currently: Lead engineer, Fernway Logistics");
    await expect(section).toContainText("Independent consultant");
    // Finished roles stay on the experience page.
    await expect(section).not.toContainText("Booking system for a clinic");
    await expect(section.getByRole("definition")).toHaveText([
      "TypeScript · PostgreSQL · React · Domain modelling",
      "Retrieval-augmented generation · Evaluations",
    ]);
    // Secondary technologies are not in the snapshot.
    await expect(section).not.toContainText("PHP");
    await expect(section.getByRole("link", { name: "Full experience" })).toHaveAttribute(
      "href",
      "/experience",
    );
    await expect(section.getByRole("link", { name: "Download CV" })).toHaveAttribute(
      "href",
      "/cv/pdf",
    );
    await expect(section.getByRole("link", { name: "Read the CV" })).toHaveAttribute("href", "/cv");
  });

  test("keeps what is being built apart from what is being learned", async ({ page }) => {
    await page.goto(website.url);
    const section = region(page, "Now");
    const columns = section.getByRole("heading", { level: 3 });
    // Exploring is the AI Roadmap's learning in progress; this fixture has no roadmap, so the column
    // is left out rather than filled with explorations or made-up activity.
    await expect(columns).toHaveText(["Working on"]);
    for (const item of workingOn) {
      await expect(section.getByRole("heading", { level: 4, name: item.title })).toBeVisible();
      await expect(section.getByRole("list", { name: `${item.title} topics` })).toHaveText(
        item.topic,
      );
      await expect(section.getByRole("link", { name: item.link })).toHaveAttribute(
        "href",
        item.href,
      );
    }
    // The focus's Markdown renders as inline elements, never as raw syntax.
    await expect(section.locator("strong").first()).toHaveText("fictional");
    // Explorations are delivered or designed work, never current learning.
    await expect(section).not.toContainText("Tool scopes");
    await expect(section).not.toContainText("Answer checker");
    await expect(section).not.toContainText("Chunk comparison");
  });

  test("leads from Now to the independent R&D on the experience page", async ({ page }) => {
    await page.goto(website.url);
    await hydrated(page);
    await region(page, "Now").getByRole("link", { name: "Independent R&D" }).click();
    await expect(page).toHaveURL(/\/experience#independent-rd$/u);
    await expect(page.locator("#independent-rd")).toBeInViewport();
  });

  test("leads from Now to the AI Roadmap and back to the site", async ({ page }) => {
    await page.goto(website.url);
    await hydrated(page);
    await region(page, "Now").getByRole("link", { name: "AI Roadmap" }).click();
    await expect(page).toHaveURL(/\/ai-roadmap$/u);
    await expect(page).toHaveTitle("AI Engineering Roadmap — Casey Morrow");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "AI Engineering Roadmap for Experienced Developers",
    );
    // The fixture has no roadmap areas: the overview says so instead of an empty tree.
    await expect(page.getByRole("main")).toContainText("No roadmap areas are published yet.");
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    await page.getByRole("banner").getByRole("link", { name: "Casey Morrow" }).click();
    await expect(page).toHaveURL(`${website.url}/`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("lists the services in short and leads to each one and to all of them", async ({ page }) => {
    await page.goto(website.url);
    const section = region(page, "Services");
    await expect(section.getByRole("heading", { level: 3 })).toHaveText(
      services.map((service) => service.name),
    );
    for (const service of services) {
      await expect(section.getByRole("link", { name: service.name })).toHaveAttribute(
        "href",
        service.href,
      );
    }
    await expect(section).toContainText(
      "Fictional manual steps replaced by small, reliable tools.",
    );
    // The fuller offer (audience, deliverable, evidence) stays on the services page.
    await expect(section).not.toContainText("Deliverable");
    await expect(section.getByRole("link", { name: "All services" })).toHaveAttribute(
      "href",
      "/services",
    );
  });

  test("follows the client path to the services page", async ({ page }) => {
    await page.goto(website.url);
    await hydrated(page);
    await page.getByRole("link", { name: "Work with me" }).click();
    await expect(page).toHaveURL(/\/services$/u);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goBack();
    await region(page, "Services").getByRole("link", { name: "AI integration" }).click();
    await expect(page).toHaveURL(/\/services#service-ai-integration$/u);
    await expect(page.locator("#service-ai-integration")).toBeInViewport();
  });

  test("follows the employer path to the experience page", async ({ page }) => {
    await page.goto(website.url);
    await hydrated(page);
    await page.getByRole("link", { name: "View my experience" }).click();
    await expect(page).toHaveURL(/\/experience$/u);
    await page.goBack();
    await region(page, "Experience").getByRole("link", { name: "Full experience" }).click();
    await expect(page).toHaveURL(/\/experience$/u);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("ends at the contact block with its email and links", async ({ page }) => {
    await page.goto(website.url);
    const contact = page.locator("#contact");
    await expect(contact.getByRole("link", { name: "Send an email" })).toHaveAttribute(
      "href",
      /^mailto:/u,
    );
    // The CV's actions moved into the experience snapshot.
    await expect(contact.getByRole("link", { name: "Download CV" })).toHaveCount(0);
  });

  test("leads to a destination that exists for every link on the page", async ({
    page,
    request,
  }) => {
    await page.goto(website.url);
    const hrefs = await page
      .locator("main a[href^='/']")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    const paths = [...new Set(hrefs.map((href) => href.split("#")[0] ?? ""))];
    expect(paths.sort()).toEqual(["/ai-roadmap", "/cv", "/cv/pdf", "/experience", "/services"]);
    for (const path of paths.filter((path) => path !== "/cv/pdf")) {
      const response = await request.get(`${website.url}${path}`);
      expect(response.status(), path).toBe(200);
    }
    // Every in-page target the links name is shown on a direct load (a closed experience opens).
    // Leaving the page first makes each one a load: going from one anchor of `/experience` to
    // another only changes the hash, and before hydration Next restores the previous address.
    for (const href of new Set(hrefs.filter((href) => href.includes("#")))) {
      const id = href.split("#")[1] ?? "";
      await page.goto("about:blank");
      await page.goto(`${website.url}${href}`);
      await expect(page.locator(`[id="${id}"]`), href).toBeVisible();
    }
  });

  for (const scheme of schemes) {
    for (const width of widths) {
      test(`fits ${String(width)} px in ${scheme} mode without violations`, async ({
        page,
      }, testInfo) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height: 900 });
        for (const [name, path] of [
          ["homepage-narrative", "/"],
          ["ai-roadmap", "/ai-roadmap"],
        ] as const) {
          await page.goto(`${website.url}${path}`);
          await page.mouse.move(0, 0);
          await expectNoHorizontalScroll(page);
          await expectAccessible(page);
          await expectTouchTargets(page);
          await page.screenshot({
            path: testInfo.outputPath(`${name}-${String(width)}-${scheme}.png`),
            fullPage: true,
          });
        }
        // The new sections close up, readable at a narrow width too.
        await page.goto(website.url);
        await page.mouse.move(0, 0);
        for (const [name, section] of [
          ["what-i-do", "What I do"],
          ["experience", "Experience"],
          ["now", "Now"],
          ["services", "Services"],
        ] as const) {
          await region(page, section).screenshot({
            path: testInfo.outputPath(`homepage-${name}-${String(width)}-${scheme}.png`),
          });
        }
      });
    }
  }
});

test.describe("homepage without focus, explorations or services", () => {
  test("leaves Now and the services out rather than showing filler", async ({ page }) => {
    // The default fixture (with-photo) has a person and nothing else.
    await page.goto("/");
    const order = await page
      .locator("main > section")
      .evaluateAll((sections) =>
        sections.map((element) => element.getAttribute("aria-labelledby")),
      );
    expect(order).toEqual([
      "hero-heading",
      "what-i-do-heading",
      "experience-snapshot-heading",
      "contact-heading",
    ]);
    // The header's navigation always links the AI Roadmap; the content must not.
    await expect(page.getByRole("main").getByRole("link", { name: "AI Roadmap" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "All services" })).toHaveCount(0);
    const snapshot = region(page, "Experience");
    await expect(snapshot.getByRole("definition")).toHaveCount(0);
    await expect(snapshot.getByRole("link", { name: "Full experience" })).toBeVisible();
  });
});
