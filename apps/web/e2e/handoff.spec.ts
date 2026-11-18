import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { startApi, startWebsite, type Fixture, type Started } from "./stack";

// The phase's handoff checks (issue #61): every page with the longest fictional content of
// e2e/fixtures/with-long-content/ at every width and in both themes, and the visitors' journeys
// across pages against e2e/fixtures/with-experience/ (Casey Morrow). The single pages' own specs
// test each part in detail; these follow a visitor from page to page.

const widths = [360, 768, 1280] as const;
const schemes = ["light", "dark"] as const;

const longName = "Maximiliana Featherstonehaugh-Cholmondeley von Wolkenstein-Trostburg";
const name = "Casey Morrow";

/** Serves the fixture to the tests of one block, so the public rate limit counts only theirs. */
function serveFixture(fixture: Fixture): { readonly url: () => string } {
  let api: Started | undefined;
  let website: Started | undefined;
  test.beforeAll(async () => {
    api = await startApi(fixture);
    website = await startWebsite(api.url);
  });
  test.afterAll(async () => {
    await website?.stop();
    await api?.stop();
  });
  return {
    url: () => {
      if (website === undefined) throw new Error("website not started");
      return website.url;
    },
  };
}

/** Waits until the page is hydrated: Next's router then marks its history entry. */
async function hydrated(page: Page) {
  await page.waitForFunction(
    () => (window.history.state as { __NA?: boolean } | null)?.__NA === true,
  );
}

async function expectLoaded(page: Page) {
  await expect(page.getByText("This page could not be loaded right now.")).toHaveCount(0);
}

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

/**
 * Every word of a link's label that fits a line stays whole: it may break after a hyphen, and only a
 * word longer than the line (an address) may break anywhere inside.
 */
async function expectWordsWhole(page: Page) {
  const broken = await page.locator("a").evaluateAll((links) =>
    links
      .filter((link) => link.checkVisibility())
      .flatMap((link) => {
        const found: string[] = [];
        const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const text = node.textContent ?? "";
          for (const match of text.matchAll(/[^\s-]+/gu)) {
            if (match[0].length > 20) continue;
            const range = document.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
            if (tops.size > 1) found.push(match[0]);
          }
        }
        return found;
      }),
  );
  expect(broken).toEqual([]);
}

/** The header's navigation labels each stay on one line. */
async function expectNavigationOnOneLine(page: Page) {
  const labels = page.getByRole("navigation", { name: "Main" }).getByRole("link");
  const lines = await labels.evaluateAll((links) =>
    links
      .filter((link) => link.checkVisibility())
      .map((link) => {
        const range = document.createRange();
        range.selectNodeContents(link);
        return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
      }),
  );
  for (const count of lines) expect(count).toBe(1);
}

function item(page: Page, anchor: string) {
  return page.locator(`[id="${anchor}"]`);
}

const conversation = (page: Page) => page.getByRole("list", { name: "Conversation" });
const turns = (page: Page) => conversation(page).locator(":scope > li");

/** Presses Tab until the target has focus, at most `limit` times. */
async function tabTo(page: Page, target: Locator, limit = 20) {
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`Tab did not reach the target in ${String(limit)} steps`);
}

/** Waits until the latest answer has ended: it is no longer marked busy. */
async function answered(page: Page) {
  await expect(turns(page).last().locator("[aria-busy='false']")).toHaveCount(1);
}

test.describe("long content", () => {
  for (const scheme of schemes) {
    test.describe(`in ${scheme} mode`, () => {
      const site = serveFixture("with-long-content");

      test.beforeEach(async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      });

      for (const width of widths) {
        test(`fits every page at ${String(width)} px`, async ({ page }, testInfo) => {
          await page.setViewportSize({ width, height: 900 });
          const shot = async (label: string, fullPage = true) => {
            await expectLoaded(page);
            await expectNoHorizontalScroll(page);
            await expectAccessible(page);
            await expectWordsWhole(page);
            await expectNavigationOnOneLine(page);
            await page.screenshot({
              path: testInfo.outputPath(`long-${label}-${String(width)}-${scheme}.png`),
              fullPage,
            });
          };

          await page.goto(site.url());
          await expect(page.getByRole("heading", { level: 1 })).toContainText(longName);
          await shot("home");

          // The case study and the secondary technologies open: their content must fit too.
          await page.goto(`${site.url()}/experience#case-study-cross-border-customs-declarations`);
          await hydrated(page);
          await expect(item(page, "case-study-cross-border-customs-declarations")).toBeVisible();
          await item(page, "technology-group-secondary")
            .getByRole("button", { name: /other technolog/u })
            .click();
          await expect(
            item(page, "technology-group-secondary").getByRole("list", {
              name: "Other technologies & tools",
            }),
          ).toBeVisible();
          await shot("experience");

          await page.goto(`${site.url()}/services`);
          await shot("services");

          await page.goto(`${site.url()}/cv`);
          await expect(page.getByRole("heading", { level: 1 })).toContainText(longName);
          await shot("cv");

          await page.goto(`${site.url()}/cv/pdf/unavailable`);
          await shot("cv-unavailable");

          // The sticky composer covers content in a full-page shot, so the viewport is taken.
          await page.goto(`${site.url()}/ask`);
          await hydrated(page);
          await page
            .getByRole("button", { name: `What could ${longName} automate for my company?` })
            .click();
          await answered(page);
          await shot("ask", false);
        });
      }

      test("prints the CV dark on white within the page", async ({ page }, testInfo) => {
        await page.emulateMedia({ media: "print", colorScheme: scheme });
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(`${site.url()}/cv`);
        await expectLoaded(page);
        await expectNoHorizontalScroll(page);
        await expectWordsWhole(page);
        await page.screenshot({
          path: testInfo.outputPath(`long-cv-print-${scheme}.png`),
          fullPage: true,
        });
        await page.pdf({ path: testInfo.outputPath(`long-cv-print-${scheme}.pdf`), format: "A4" });
      });
    });
  }
});

test.describe("a client", () => {
  const site = serveFixture("with-experience");

  test("goes from the homepage to a service's evidence and contacts from an inner page", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto(site.url());
    await hydrated(page);
    await page.getByRole("banner").getByRole("link", { name: "Services" }).click();
    await expect(page).toHaveURL(/\/services$/u);
    await expectLoaded(page);

    // The evidence leads to the exact project, opened inside its closed experience.
    await item(page, "service-process-automation")
      .getByRole("link", { name: "Clinic scheduling" })
      .click();
    await expect(page).toHaveURL(/\/experience#project-clinic-scheduling$/u);
    await expect(item(page, "project-clinic-scheduling")).toBeFocused();

    // Contact from an inner page lands on the homepage's contact block.
    await page.getByRole("banner").getByRole("link", { name: "Contact" }).click();
    await expect(page).toHaveURL(/\/#contact$/u);
    const contact = page.locator("#contact");
    await expect(contact).toBeInViewport();
    await expect(contact.getByRole("link", { name: "Send an email" })).toHaveAttribute(
      "href",
      /^mailto:/u,
    );
  });
});

test.describe("a recruiter", () => {
  const site = serveFixture("with-experience");

  test("goes from the homepage to the experience and the CV, downloads and prints it", async ({
    page,
  }) => {
    await page.goto(site.url());
    await hydrated(page);
    await page.getByRole("link", { name: "View my experience" }).click();
    await expect(page).toHaveURL(/\/experience$/u);
    await expectLoaded(page);

    await page.locator("main header").getByRole("link", { name: "Read the CV" }).click();
    await expect(page).toHaveURL(/\/cv$/u);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(name);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("main").getByRole("link", { name: "Download CV" }).first().click(),
    ]);
    expect(download.suggestedFilename()).toBe("casey-morrow-cv.pdf");

    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("contentinfo")).toBeHidden();
    await expect(page.getByRole("link", { name: "Download CV" })).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("an evaluator", () => {
  const site = serveFixture("with-experience");

  test("follows the selected work, the independent R&D and the AI Roadmap", async ({ page }) => {
    await page.goto(site.url());
    await hydrated(page);
    await page.getByRole("link", { name: "Read the case study: Clinic scheduling" }).click();
    await expect(page).toHaveURL(/\/experience#case-study-clinic-scheduling$/u);
    await expect(item(page, "case-study-clinic-scheduling")).toBeInViewport();
    await expect(item(page, "case-study-clinic-scheduling")).toContainText("My role");

    await page.goto(site.url());
    await hydrated(page);
    const now = page.getByRole("region", { name: "Now", exact: true });
    await now.getByRole("link", { name: "Independent R&D" }).click();
    await expect(page).toHaveURL(/\/experience#independent-rd$/u);
    await expect(page.locator("#independent-rd")).toBeInViewport();
    await expect(page.locator("#independent-rd")).toContainText(
      "Unimplemented design, planned or architected only",
    );

    await page.getByRole("banner").getByRole("link", { name: "AI Roadmap" }).click();
    await expect(page).toHaveURL(/\/ai-roadmap$/u);
    // The fixture has no roadmap areas: the overview says so instead of an empty tree.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "AI Engineering Roadmap for Experienced Developers",
    );
    await expect(page.getByRole("main")).toContainText("No roadmap areas are published yet.");
  });
});

test.describe("a visitor asking", () => {
  const site = serveFixture("with-experience");

  test("asks from the hero, follows a source and recovers from a failed answer", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(site.url());
    await hydrated(page);
    await page
      .getByRole("list", { name: "Suggested questions" })
      .getByRole("button", { name: "AI role fit?" })
      .click();
    await expect(page).toHaveURL(/\/ask\?c=/u);
    await answered(page);
    const sources = turns(page).last().getByRole("list", { name: "Sources", exact: true });
    await expect(sources.getByRole("link")).toHaveCount(5);

    // A failed answer is labelled and offered again; the retry answers in place.
    await page.evaluate(() => {
      window.__sebelaMockChatScenarios = ["error-after-start"];
    });
    const composer = page.getByRole("textbox", { name: "Your question" });
    await composer.fill(`What could ${name} automate for my company?`);
    await composer.press("Enter");
    await answered(page);
    await expect(turns(page).last().getByText("Incomplete", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await answered(page);
    await expect(turns(page)).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);

    await turns(page)
      .last()
      .getByRole("list", { name: "Sources", exact: true })
      .getByRole("link", { name: "AI integration", exact: true })
      .click();
    await expect(page).toHaveURL(/\/services#service-ai-integration$/u);
    await expect(item(page, "service-ai-integration")).toBeInViewport();
  });
});

test.describe("a keyboard user on a phone", () => {
  const site = serveFixture("with-experience");

  test("reaches Services through the menu and the contact block, without a pointer", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(site.url());
    await hydrated(page);
    const menuButton = page.getByRole("banner").getByRole("button", { name: "Menu", exact: true });
    await tabTo(page, menuButton);
    await page.keyboard.press("Enter");
    const menu = page.getByRole("dialog", { name: "Menu" });
    await expect(menu).toBeVisible();
    await tabTo(page, menu.getByRole("link", { name: "Services" }));
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/services$/u);
    await expect(menu).toBeHidden();

    // The closing action leads to the contact block.
    await tabTo(page, page.getByRole("link", { name: "Get in touch", exact: true }), 80);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/#contact$/u);
    await expect(page.locator("#contact")).toBeInViewport();
  });
});
