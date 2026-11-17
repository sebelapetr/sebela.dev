import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { startApi, startWebsite, type Started } from "./stack";

// Fixture values (e2e/fixtures/with-experience/): a fictional career that exists only for these
// tests. In the API's order: current roles first, then the latest start.
const career = [
  {
    anchor: "experience-fernway-lead-engineer",
    title: "Lead engineer",
    organization: "Fernway Logistics",
    period: "October 1st, 2023 – present",
    kind: "Main job",
    current: true,
  },
  {
    anchor: "experience-morrow-studio-consultant",
    title: "Independent consultant",
    organization: "Morrow Studio",
    period: "July 12th, 2021 – present",
    kind: "Own business",
    current: true,
  },
  {
    anchor: "experience-open-ledger-kit-maintainer",
    title: "Maintainer",
    organization: "Open Ledger Kit",
    period: "January 3rd, 2022 – November 22nd, 2022",
    kind: "Side project",
    current: false,
  },
  {
    anchor: "experience-harbor-clinic-booking",
    title: "Booking system for a clinic",
    organization: "Harbor Clinic",
    period: "August 2nd, 2021 – February 21st, 2022",
    kind: "Own business",
    current: false,
  },
  {
    anchor: "experience-pinecrest-senior-developer",
    title: "Senior developer",
    organization: "Pinecrest Health",
    period: "May 11th, 2020 – September 30th, 2023",
    kind: "Main job",
    current: false,
  },
  {
    anchor: "experience-pinecrest-developer",
    title: "Developer",
    organization: "Pinecrest Health",
    period: "March 1st, 2018 – May 10th, 2020",
    kind: "Main job",
    current: false,
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

function item(page: Page, anchor: string) {
  return page.locator(`[id="${anchor}"]`);
}

test.describe("experience page read from the API", () => {
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

  test("shows the header, the CV link and every experience as its own row in order", async ({
    page,
  }) => {
    const response = await page.goto(`${website.url}/experience`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Experience — Casey Morrow");

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toContainText("Casey Morrow");
    await expect(heading).toContainText("Experience");
    await expect(page.locator("main header")).toContainText(
      "Fictional engineer who builds calm software for logistics and health care",
    );
    await expect(page.locator("main header")).toContainText(
      /\d+ years of professional experience/u,
    );
    await expect(page.getByRole("link", { name: "Read the CV" })).toHaveAttribute("href", "/cv");

    // Every experience is a row of the timeline itself: client and side work are never nested
    // under an employer.
    const rows = page.locator('[data-slot="timeline"] > li');
    await expect(rows).toHaveCount(career.length);
    for (const [index, entry] of career.entries()) {
      const row = rows.nth(index);
      await expect(row).toHaveAttribute("id", entry.anchor);
      const trigger = row.getByRole("button");
      await expect(row.getByRole("heading", { level: 2 })).toContainText(entry.title);
      await expect(trigger).toContainText(entry.period);
      await expect(trigger).toContainText(entry.kind);
      await expect(trigger).toContainText(entry.organization);
    }
  });

  test("opens only the current experiences at first; older ones are compact rows", async ({
    page,
  }) => {
    await page.goto(`${website.url}/experience`);
    for (const entry of career) {
      const row = item(page, entry.anchor);
      await expect(row.getByRole("button")).toHaveAttribute("aria-expanded", String(entry.current));
      const content = row.getByRole("region");
      if (entry.current) {
        await expect(content).toBeVisible();
      } else {
        // Closed content stays findable by the browser's page search.
        await expect(row.locator('[data-slot="timeline-content"]')).toHaveAttribute(
          "hidden",
          "until-found",
        );
      }
    }
    const lead = item(page, "experience-fernway-lead-engineer");
    await expect(lead.getByRole("region")).toContainText("routing platform");
    await expect(lead.getByRole("list", { name: "Technologies" })).toContainText("TypeScript");
  });

  test("opens and closes an experience by keyboard", async ({ page }) => {
    await page.goto(`${website.url}/experience`);
    const row = item(page, "experience-pinecrest-senior-developer");
    const trigger = row.getByRole("button");
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const content = row.getByRole("region", { name: /Senior developer/u });
    await expect(content).toBeVisible();
    await expect(content.locator("li").first()).toBeVisible();
    await page.keyboard.press("Space");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(content).toBeHidden();

    // The focus ring is visible on a trigger.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    expect(await trigger.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe(
      "none",
    );
  });

  test("shows each testimonial only beside its own experience", async ({ page }) => {
    await page.goto(`${website.url}/experience`);
    const quotes = page.getByRole("blockquote", { includeHidden: true });
    await expect(quotes).toHaveCount(2);
    await expect(
      item(page, "experience-fernway-lead-engineer").getByRole("blockquote"),
    ).toContainText("dispatch tools quiet");
    await expect(
      item(page, "experience-pinecrest-senior-developer").getByRole("blockquote", {
        includeHidden: true,
      }),
    ).toContainText("centre by centre");
    for (const anchor of [
      "experience-morrow-studio-consultant",
      "experience-pinecrest-developer",
      "experience-harbor-clinic-booking",
    ]) {
      await expect(item(page, anchor).getByRole("blockquote", { includeHidden: true })).toHaveCount(
        0,
      );
    }
  });

  test("links to an experience by its stable anchor", async ({ page }) => {
    await page.goto(`${website.url}/experience#experience-pinecrest-developer`);
    await expect(item(page, "experience-pinecrest-developer")).toBeInViewport();
  });

  for (const scheme of schemes) {
    for (const width of widths) {
      test(`fits ${String(width)} px in ${scheme} mode without violations`, async ({
        page,
      }, testInfo) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${website.url}/experience`);
        // One older experience opened, beside the current ones.
        await item(page, "experience-pinecrest-senior-developer").getByRole("button").click();
        await expect(
          item(page, "experience-pinecrest-senior-developer").getByRole("region"),
        ).toBeVisible();
        // No hover state in the picture.
        await page.mouse.move(0, 0);
        await expectNoHorizontalScroll(page);
        await expectAccessible(page);
        // Touch targets: every visible link and button is at least 44 px tall (the fixture has no
        // links inside running text).
        const heights = await page
          .locator("main a, main button, footer a")
          .evaluateAll((elements) =>
            elements
              .filter((element) => element.checkVisibility())
              .map((element) => element.getBoundingClientRect().height),
          );
        for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
        await page.screenshot({
          path: testInfo.outputPath(`experience-${String(width)}-${scheme}.png`),
          fullPage: true,
        });
      });
    }
  }
});

test.describe("experience page without experiences", () => {
  test("says that no experience is published yet", async ({ page }) => {
    const response = await page.goto("/experience");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Experience");
    await expect(page.locator("main")).toContainText("No experience is published yet.");
    await expect(page.locator('[data-slot="timeline"]')).toHaveCount(0);
    await expectAccessible(page);
  });
});
