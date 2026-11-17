import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { startApi, startWebsite, type Started } from "./stack";

// Fixture values (e2e/fixtures/with-experience/services.json and person.json): three fictional
// offers in their stored order. The first links two projects, one inside an experience that is
// closed on load, and a page the site does not have; the second has no evidence; the third links a
// built and a designed exploration and the independent R&D block.
const services = [
  { number: "01", anchor: "service-process-automation", name: "Process automation" },
  { number: "02", anchor: "service-custom-software", name: "Custom software" },
  { number: "03", anchor: "service-ai-integration", name: "AI integration" },
] as const;

const contact = {
  email: "casey@morrow.example.test",
  links: [
    { label: "LinkedIn", url: "https://linkedin.example.test/in/casey-morrow" },
    { label: "GitHub", url: "https://github.example.test/casey-morrow" },
  ],
} as const;

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

/**
 * Waits until the page is hydrated: Next's router then marks its history entry, and client
 * navigation by a link is in place.
 */
async function hydrated(page: Page) {
  await page.waitForFunction(
    () => (window.history.state as { __NA?: boolean } | null)?.__NA === true,
  );
}

function item(page: Page, anchor: string) {
  return page.locator(`[id="${anchor}"]`);
}

function part(page: Page, anchor: string, label: string) {
  return item(page, anchor).locator("dt", { hasText: label }).locator("xpath=..");
}

test.describe("services page read from the API", () => {
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

  test("shows the intro and the offers as numbered rows in order at their anchors", async ({
    page,
  }) => {
    const response = await page.goto(`${website.url}/services`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Services — Casey Morrow");

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toContainText("Casey Morrow");
    await expect(heading).toContainText("Services");
    await expect(page.locator("main header")).toContainText(
      "Casey turns fictional manual work into calm software for small teams.",
    );
    // The intro's Markdown renders, never as raw text.
    await expect(page.locator("main header em")).toHaveText("fictional");

    const rows = page.getByRole("list", { name: "Services" }).locator("> li");
    await expect(rows).toHaveCount(services.length);
    for (const [index, service] of services.entries()) {
      const row = rows.nth(index);
      await expect(row).toHaveAttribute("id", service.anchor);
      await expect(row.getByRole("heading", { level: 2 })).toHaveText(service.name);
      await expect(row).toContainText(service.number);
      await expect(row.locator("dt")).toContainText(["For", "You get"]);
    }
    await expect(rows.nth(0)).toContainText("Fictional clinics and logistics teams.");
    await expect(rows.nth(0)).toContainText("A working tool, its documentation and a hand-over.");
  });

  test("links each piece of evidence to its exact item and keeps R&D apart from projects", async ({
    page,
  }) => {
    await page.goto(`${website.url}/services`);

    // Projects: career work, each to its own anchor.
    const projects = part(page, "service-process-automation", "Projects");
    await expect(projects.getByRole("link", { name: "Clinic scheduling" })).toHaveAttribute(
      "href",
      "/experience#project-clinic-scheduling",
    );
    await expect(projects.getByRole("link", { name: "Ledger importer" })).toHaveAttribute(
      "href",
      "/experience#project-ledger-importer",
    );
    // A page the site does not have is never linked.
    await expect(page.locator('main a[href="/projects"]')).toHaveCount(0);
    await expect(item(page, "service-process-automation")).not.toContainText("See also");

    // Without evidence: no evidence part and no claim.
    const software = item(page, "service-custom-software");
    await expect(software.locator("dt")).toHaveText(["For", "You get"]);
    await expect(software.getByRole("link")).toHaveCount(0);

    // Independent R&D, with its stored status as text; never under projects.
    const ai = item(page, "service-ai-integration");
    await expect(ai.locator("dt")).toHaveText([
      "For",
      "You get",
      "Independent R&D",
      "See also",
      "Planned, not built",
    ]);
    const rd = part(page, "service-ai-integration", "Independent R&D");
    await expect(rd.getByRole("link", { name: "Answer checker" })).toHaveAttribute(
      "href",
      "/experience#exploration-answer-checker",
    );
    await expect(rd).toContainText("Built");
    await expect(rd).toContainText("Implemented and working");
    await expect(rd).not.toContainText("Tool scopes");
    // Designed work is planned only, never presented as evidence.
    const planned = part(page, "service-ai-integration", "Planned, not built");
    await expect(planned.getByRole("link", { name: "Tool scopes" })).toHaveAttribute(
      "href",
      "/experience#exploration-tool-scopes",
    );
    await expect(planned).toContainText("Designed");
    await expect(planned).toContainText("Unimplemented design, planned or architected only");
    await expect(
      part(page, "service-ai-integration", "See also").getByRole("link", {
        name: "Independent R&D",
      }),
    ).toHaveAttribute("href", "/experience#independent-rd");
  });

  test("shows how a collaboration runs and the honest note on practice and focus", async ({
    page,
  }) => {
    await page.goto(`${website.url}/services`);
    const note = page.getByRole("complementary", { name: "Experience and focus" });
    await expect(note).toHaveText(
      "Software delivery is Casey's long-standing practice; the AI work is a newer focus, shown as independent R&D.",
    );
    const section = page.getByRole("region", { name: "How I work" });
    const steps = section.getByRole("list", { name: "Collaboration steps" }).locator("> li");
    await expect(steps.getByRole("heading", { level: 3 })).toHaveText([
      "Talk it through",
      "Agree on the scope",
      "Build in small steps",
      "Hand it over",
    ]);
    await expect(steps.nth(2)).toContainText("03");
    await expect(steps.nth(2).locator("strong")).toHaveText("early");
  });

  test("links to a service by its stable anchor", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto(`${website.url}/services#service-ai-integration`);
    await expect(item(page, "service-ai-integration")).toBeInViewport();
  });

  test("follows Services to a project inside a closed experience, opened and focused", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto(`${website.url}/services`);
    await hydrated(page);
    await part(page, "service-process-automation", "Projects")
      .getByRole("link", { name: "Clinic scheduling" })
      .click();
    await expect(page).toHaveURL(/\/experience#project-clinic-scheduling$/u);
    // Pinecrest's senior role is closed on load; the link opens it around the project.
    await expect(
      item(page, "experience-pinecrest-senior-developer").locator('[data-slot="timeline-trigger"]'),
    ).toHaveAttribute("aria-expanded", "true");
    const target = item(page, "project-clinic-scheduling");
    await expect(target).toBeVisible();
    await expect(target).toBeInViewport();
    await expect(target).toBeFocused();
  });

  test("follows Services to a designed exploration that says it is only designed", async ({
    page,
  }) => {
    await page.goto(`${website.url}/services`);
    await hydrated(page);
    await part(page, "service-ai-integration", "Planned, not built")
      .getByRole("link", { name: "Tool scopes" })
      .click();
    await expect(page).toHaveURL(/\/experience#exploration-tool-scopes$/u);
    const target = item(page, "exploration-tool-scopes");
    await expect(target).toBeInViewport();
    await expect(target).toBeFocused();
    await expect(target).toContainText("Unimplemented design, planned or architected only");
  });

  test("leads from the closing action to the homepage's contact block with its links", async ({
    page,
  }) => {
    await page.goto(`${website.url}/services`);
    await hydrated(page);
    const action = page.getByRole("link", { name: "Get in touch", exact: true });
    await expect(action).toHaveAttribute("href", "/#contact");
    await action.click();
    await expect(page).toHaveURL(/\/#contact$/u);
    const block = page.locator("#contact");
    await expect(block).toBeInViewport();
    await expect(block.getByRole("link", { name: contact.email })).toHaveAttribute(
      "href",
      `mailto:${contact.email}`,
    );
    for (const link of contact.links) {
      await expect(block.getByRole("link", { name: link.label, exact: true })).toHaveAttribute(
        "href",
        link.url,
      );
    }
  });

  test("is operable by keyboard in reading order", async ({ page }) => {
    await page.goto(`${website.url}/services`);
    const names: string[] = [];
    for (let step = 0; step < 7; step += 1) {
      await page.keyboard.press("Tab");
      names.push(
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText ?? ""),
      );
    }
    expect(names.map((name) => name.trim())).toEqual([
      "Clinic scheduling",
      "Ledger importer",
      "Answer checker",
      "Independent R&D",
      "Tool scopes",
      "Get in touch",
      "Built in public with an agentic engineering workflow",
    ]);
  });

  for (const scheme of schemes) {
    for (const width of widths) {
      test(`fits ${String(width)} px in ${scheme} mode without violations`, async ({
        page,
      }, testInfo) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${website.url}/services`);
        // No hover state in the picture.
        await page.mouse.move(0, 0);
        await expectNoHorizontalScroll(page);
        await expectAccessible(page);
        await expectTouchTargets(page);
        await page.screenshot({
          path: testInfo.outputPath(`services-${String(width)}-${scheme}.png`),
          fullPage: true,
        });
      });
    }
  }
});

test.describe("services page without services or services prose", () => {
  test("says that no service is published yet and still leads to contact", async ({ page }) => {
    const response = await page.goto("/services");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Services");
    await expect(page.locator("main")).toContainText("No services are published yet.");
    // Nothing is invented for what is not published.
    await expect(page.getByRole("list", { name: "Services" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "How I work" })).toHaveCount(0);
    await expect(page.getByRole("complementary")).toHaveCount(0);
    await expect(page.locator("main header > :not(h1)")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Get in touch", exact: true })).toHaveAttribute(
      "href",
      "/#contact",
    );
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);
  });
});
