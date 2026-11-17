import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { startApi, startWebsite, type Started } from "./stack";

// Fixture values (e2e/fixtures/with-experience/projects.json): fictional projects that exist only
// for these tests. Selected, in the API's order (experience order, then position): the route
// planner (current experience, with a case study), the ledger importer (side project, no case
// study) and clinic scheduling (an older, closed experience, with a case study). The records export
// is not selected and has no case study.
const selected = [
  {
    number: "01",
    name: "Route planner",
    period: "February 1st, 2024 – present",
    role: "Lead engineer",
    href: "/experience#case-study-route-planner",
    link: "Read the case study: Route planner",
  },
  {
    number: "02",
    name: "Ledger importer",
    period: "January 10th, 2022 – November 22nd, 2022",
    role: null,
    href: "/experience#project-ledger-importer",
    link: "View the project: Ledger importer",
  },
  {
    number: "03",
    name: "Clinic scheduling",
    period: "March 1st, 2021 – June 30th, 2022",
    role: "Senior developer responsible for the booking flow",
    href: "/experience#case-study-clinic-scheduling",
    link: "Read the case study: Clinic scheduling",
  },
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
 * Waits until the page is hydrated: Next's router then marks its history entry. Before that, the
 * router replaces the entry with the address it started from, so a hash set earlier is lost.
 */
async function hydrated(page: Page) {
  await page.waitForFunction(
    () => (window.history.state as { __NA?: boolean } | null)?.__NA === true,
  );
}

function item(page: Page, anchor: string) {
  return page.locator(`[id="${anchor}"]`);
}

function experienceTrigger(page: Page, anchor: string) {
  return item(page, anchor).locator('[data-slot="timeline-trigger"]');
}

/** The target is open, below the top of the viewport by the scroll margin, and has focus. */
async function expectOpenedAt(page: Page, anchor: string) {
  const target = item(page, anchor);
  await expect(target).toBeVisible();
  await expect(target).toBeInViewport();
  await expect(target).toBeFocused();
  // Scrolled to its own top with room above it, not to the top of the experience around it.
  await expect
    .poll(() => target.evaluate((element) => Math.round(element.getBoundingClientRect().top)))
    .toBe(32);
}

test.describe("selected work and deep links into the experience page", () => {
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

  test("shows the selected projects as numbered rows that link to their exact items", async ({
    page,
  }) => {
    await page.goto(website.url);
    const section = page.getByRole("region", { name: "Selected work" });
    await expect(section.getByRole("heading", { level: 2 })).toHaveText("Selected work");

    const rows = section.getByRole("listitem").filter({ has: page.getByRole("heading") });
    await expect(rows).toHaveCount(selected.length);
    for (const [index, project] of selected.entries()) {
      const row = rows.nth(index);
      await expect(row.getByRole("heading", { level: 3 })).toHaveText(project.name);
      await expect(row).toContainText(project.number);
      await expect(row).toContainText(project.period);
      await expect(row).toContainText("Problem");
      await expect(row).toContainText("Result");
      if (project.role === null) {
        // No role is invented for a project without a case study.
        await expect(row).not.toContainText("My role");
      } else {
        await expect(row).toContainText(project.role);
      }
      await expect(row.getByRole("link", { name: project.link })).toHaveAttribute(
        "href",
        project.href,
      );
    }
    // Not selected: not on the homepage.
    await expect(section).not.toContainText("Records export");
    await expect(section.getByRole("link", { name: "View full experience" })).toHaveAttribute(
      "href",
      "/experience",
    );
    // Selected work sits between the hero and the contact block.
    const order = await page
      .locator("main > section")
      .evaluateAll((sections) =>
        sections.map((element) => element.getAttribute("aria-labelledby")),
      );
    expect(order).toEqual(["hero-heading", "selected-work-heading", "contact-heading"]);
  });

  test("shows the projects inside their own experience, with the case study behind a disclosure", async ({
    page,
  }) => {
    await page.goto(`${website.url}/experience`);
    const planner = item(page, "project-route-planner");
    await expect(item(page, "experience-fernway-lead-engineer")).toContainText("Route planner");
    await expect(planner).toContainText("February 1st, 2024 – present");
    await expect(planner).toContainText("Plans the daily routes");
    await expect(planner.getByRole("list", { name: "Route planner technologies" })).toContainText(
      "TypeScript",
    );

    // The case study is closed at first, and its content stays findable by page search.
    const button = page.getByRole("button", { name: "Case study: Route planner" });
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(
      item(page, "case-study-route-planner").locator('[data-slot="collapsible-content"]'),
    ).toHaveAttribute("hidden", "until-found");

    // By keyboard: context, problem, role, solution with the account, result.
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const caseStudy = item(page, "case-study-route-planner");
    await expect(caseStudy).toContainText("Lead engineer");
    await expect(caseStudy.getByRole("heading", { level: 5, name: "Approach" })).toBeVisible();
    const labels = await caseStudy.locator("dt").allTextContents();
    expect(labels).toEqual(["Problem", "My role", "Solution", "Result"]);
    await page.keyboard.press("Space");
    await expect(button).toHaveAttribute("aria-expanded", "false");

    // Without a case study: the evidence shows, with no role and no empty disclosure.
    await experienceTrigger(page, "experience-pinecrest-senior-developer").click();
    const exportRow = item(page, "project-records-export");
    await expect(exportRow).toContainText("Exports were assembled by hand");
    await expect(exportRow.locator("dt")).toHaveText(["Problem", "Solution", "Result"]);
    await expect(exportRow.getByRole("button")).toHaveCount(0);
    await expect(item(page, "case-study-records-export")).toHaveCount(0);

    // An experience without projects shows no projects list.
    await expect(
      item(page, "experience-morrow-studio-consultant").getByRole("list", { name: "Projects" }),
    ).toHaveCount(0);
  });

  test("opens a case study inside a closed experience on a direct load", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto(`${website.url}/experience#case-study-clinic-scheduling`);
    await expect(experienceTrigger(page, "experience-pinecrest-senior-developer")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(
      page.getByRole("button", { name: "Case study: Clinic scheduling" }),
    ).toHaveAttribute("aria-expanded", "true");
    await expectOpenedAt(page, "case-study-clinic-scheduling");
    // Nothing unrelated opened.
    await expect(experienceTrigger(page, "experience-pinecrest-developer")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.getByRole("button", { name: "Case study: Route planner" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // Hydration kept it open and in place.
    await hydrated(page);
    await expectOpenedAt(page, "case-study-clinic-scheduling");

    // The target is in the tab order's flow: the next Tab reaches its own disclosure button.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Case study: Clinic scheduling" })).toBeFocused();
  });

  test("opens a project inside a closed experience on a direct load", async ({ page }) => {
    await page.goto(`${website.url}/experience#project-records-export`);
    await expect(experienceTrigger(page, "experience-pinecrest-senior-developer")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expectOpenedAt(page, "project-records-export");
  });

  test("follows a homepage teaser to the exact case study by client navigation", async ({
    page,
  }) => {
    await page.goto(website.url);
    await hydrated(page);
    // Mark the document: a client navigation keeps it, a full load would not.
    await page.evaluate(() => {
      (window as unknown as { marker: boolean }).marker = true;
    });
    await page.getByRole("link", { name: "Read the case study: Clinic scheduling" }).click();
    await expect(page).toHaveURL(/\/experience#case-study-clinic-scheduling$/u);
    await expectOpenedAt(page, "case-study-clinic-scheduling");
    expect(await page.evaluate(() => (window as unknown as { marker?: boolean }).marker)).toBe(
      true,
    );

    // Back to the homepage, then forward again: the case study opens again at its place.
    await page.goBack();
    await expect(page.getByRole("region", { name: "Selected work" })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/#case-study-clinic-scheduling$/u);
    await expectOpenedAt(page, "case-study-clinic-scheduling");
  });

  test("opens what a hash change names, and again on back and forward", async ({ page }) => {
    await page.goto(`${website.url}/experience`);
    await hydrated(page);
    await page.evaluate(() => {
      window.location.hash = "project-ledger-importer";
    });
    await expect(experienceTrigger(page, "experience-open-ledger-kit-maintainer")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expectOpenedAt(page, "project-ledger-importer");

    await page.evaluate(() => {
      window.location.hash = "case-study-clinic-scheduling";
    });
    await expectOpenedAt(page, "case-study-clinic-scheduling");

    // Close what the hash opened, then go back and forward: the history entry opens it again.
    await experienceTrigger(page, "experience-open-ledger-kit-maintainer").click();
    await page.goBack();
    await expect(page).toHaveURL(/#project-ledger-importer$/u);
    await expectOpenedAt(page, "project-ledger-importer");
    await page.goForward();
    await expect(page).toHaveURL(/#case-study-clinic-scheduling$/u);
    await expectOpenedAt(page, "case-study-clinic-scheduling");
  });

  test("leaves the page usable and opens nothing for an unknown anchor", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${website.url}/experience#case-study-records-export`);
    await hydrated(page);
    for (const anchor of [
      "experience-open-ledger-kit-maintainer",
      "experience-harbor-clinic-booking",
      "experience-pinecrest-senior-developer",
      "experience-pinecrest-developer",
    ]) {
      await expect(experienceTrigger(page, anchor)).toHaveAttribute("aria-expanded", "false");
    }
    await expect(page.getByRole("button", { name: /^Case study/u })).toHaveCount(1);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // Still usable: an experience opens on click.
    await experienceTrigger(page, "experience-pinecrest-developer").click();
    await expect(experienceTrigger(page, "experience-pinecrest-developer")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await page.goto(`${website.url}/experience#project-removed-long-ago`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Experience");
    expect(errors).toEqual([]);
  });

  test("jumps at once to the target when reduced motion is requested", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${website.url}/experience`);
    await hydrated(page);
    await page.evaluate(() => {
      window.location.hash = "case-study-clinic-scheduling";
    });
    // No smooth scrolling: the very next frames already show the target at its place.
    await expectOpenedAt(page, "case-study-clinic-scheduling");
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
    ).toBe("auto");
  });

  for (const scheme of schemes) {
    for (const width of widths) {
      test(`fits ${String(width)} px in ${scheme} mode without violations`, async ({
        page,
      }, testInfo) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height: 900 });

        await page.goto(website.url);
        await expect(page.getByRole("region", { name: "Selected work" })).toBeVisible();
        await page.mouse.move(0, 0);
        await expectNoHorizontalScroll(page);
        await expectAccessible(page);
        await expectTouchTargets(page);
        await page.screenshot({
          path: testInfo.outputPath(`selected-work-${String(width)}-${scheme}.png`),
          fullPage: true,
        });

        await page.goto(`${website.url}/experience#case-study-clinic-scheduling`);
        await expectOpenedAt(page, "case-study-clinic-scheduling");
        // Out of the focus state, so the picture shows the page at rest.
        await page.evaluate(() => {
          (document.activeElement as HTMLElement | null)?.blur();
        });
        await page.mouse.move(0, 0);
        await expectNoHorizontalScroll(page);
        await expectAccessible(page);
        await expectTouchTargets(page);
        await page.screenshot({
          path: testInfo.outputPath(`case-study-${String(width)}-${scheme}.png`),
        });
        await page.screenshot({
          path: testInfo.outputPath(`case-study-full-${String(width)}-${scheme}.png`),
          fullPage: true,
        });
      });
    }
  }
});

test.describe("homepage without selected work", () => {
  test("leaves the block out rather than showing filler", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Selected work" })).toHaveCount(0);
    await expect(page.getByText("Selected work")).toHaveCount(0);
  });
});
