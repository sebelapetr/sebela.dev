import { readdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { fixtureFolder, startApi, startWebsite, type Started, type StartedApi } from "./stack";

// Fixture values (e2e/fixtures/with-experience/): the fictional Casey Morrow with a CV PDF of their
// own (files/cv.pdf). The CV lists the experiences marked for it in the API's order (Open Ledger
// Kit is not marked), the three explorations with their statuses, the skills and the education.
const cvExperiences = [
  "Lead engineer · Fernway Logistics",
  "Independent consultant · Morrow Studio",
  "Booking system for a clinic · Harbor Clinic",
  "Senior developer · Pinecrest Health",
  "Developer · Pinecrest Health",
] as const;

const explorations = [
  { name: "Answer checker", status: "Built", meaning: "Implemented and working" },
  { name: "Chunk comparison", status: "Tested", meaning: "Tried hands-on" },
  {
    name: "Tool scopes",
    status: "Designed",
    meaning: "Unimplemented design, planned or architected only",
  },
] as const;

const skills = [
  { label: "Core", technologies: "TypeScript, PostgreSQL, React, Domain modelling" },
  { label: "AI engineering focus", technologies: "Retrieval-augmented generation, Evaluations" },
  { label: "Other technologies & tools", technologies: "Python, PHP, Make" },
] as const;

const pdfPath = join(fixtureFolder("with-experience"), "files", "cv.pdf");
// Each API a test starts keeps its files in a storage folder of its own (`StartedApi.storage`,
// `e2e/stack.ts`), so a test changes only its own server's files while other files run.

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

/** Waits until the page is hydrated, so client navigation by a link is in place. */
async function hydrated(page: Page) {
  await page.waitForFunction(
    () => (window.history.state as { __NA?: boolean } | null)?.__NA === true,
  );
}

/** Today's calendar day in UTC: the fixture's PDF is uploaded when the API's server starts. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The stored copies of the fixture's PDF in the API's end-to-end storage folders. */
async function storedPdfs(storage: string): Promise<string[]> {
  const expected = await readFile(pdfPath);
  const found: string[] = [];
  for (const entry of await readdir(storage, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    if ((await readFile(path)).equals(expected)) found.push(path);
  }
  return found;
}

test.describe("CV and its PDF read from the API", () => {
  let api: StartedApi;
  let website: Started;

  test.beforeAll(async () => {
    api = await startApi("with-experience");
    website = await startWebsite(api.url);
  });

  test.afterAll(async () => {
    await website.stop();
    await api.stop();
  });

  test("follows the homepage to Experience and downloads the uploaded PDF itself", async ({
    page,
  }) => {
    await page.goto(website.url);
    await hydrated(page);
    // The homepage's experience snapshot offers the PDF too, with its date.
    const snapshot = page.getByRole("region", { name: "Experience", exact: true });
    await expect(snapshot.getByRole("link", { name: "Download CV" })).toHaveAttribute(
      "href",
      "/cv/pdf",
    );
    await expect(snapshot.locator("time")).toHaveAttribute("datetime", today());

    await page.getByRole("link", { name: "View my experience" }).click();
    await expect(page).toHaveURL(/\/experience$/u);
    const header = page.locator("main header");
    await expect(header.getByRole("link", { name: "Read the CV" })).toHaveAttribute("href", "/cv");
    const date = header.locator("time");
    await expect(date).toHaveAttribute("datetime", today());
    await expect(header).toContainText(/PDF updated \w+ \d+(st|nd|rd|th), \d{4}/u);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      header.getByRole("link", { name: "Download CV" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("casey-morrow-cv.pdf");
    const saved = await download.path();
    expect((await readFile(saved)).equals(await readFile(pdfPath))).toBe(true);

    const response = await page.request.get(`${website.url}/cv/pdf`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect((await response.body()).equals(await readFile(pdfPath))).toBe(true);
  });

  test("renders the assembled CV in one column, in the API's order, with statuses", async ({
    page,
  }) => {
    const response = await page.goto(`${website.url}/cv`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("CV — Casey Morrow");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Casey Morrow");
    const contacts = page.getByRole("list", { name: "Contacts" });
    await expect(contacts).toContainText("Testville");
    await expect(contacts.getByRole("link", { name: "casey@morrow.example.test" })).toHaveAttribute(
      "href",
      "mailto:casey@morrow.example.test",
    );
    await expect(contacts.getByRole("link", { name: "GitHub", exact: true })).toHaveAttribute(
      "href",
      "https://github.example.test/casey-morrow",
    );
    await expect(page.getByRole("link", { name: "Download CV" })).toHaveAttribute(
      "href",
      "/cv/pdf",
    );
    await expect(page.locator("main time")).toHaveAttribute("datetime", today());

    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Summary",
      "Experience",
      "Independent R&D",
      "Skills",
      "Education",
    ]);
    await expect(page.getByRole("region", { name: "Summary" }).locator("strong")).toHaveText(
      "fictional",
    );

    // Only the experiences the API selected; the explorations are never among them.
    const experience = page.getByRole("list", { name: "Experience" }).locator("> li");
    await expect(experience.getByRole("heading", { level: 3 })).toHaveText([...cvExperiences]);
    await expect(page.locator("main")).not.toContainText("Open Ledger Kit");
    await expect(experience.first()).toContainText("October 1st, 2023 – present");
    await expect(experience.first()).toContainText("Full-time job");

    const rd = page.getByRole("list", { name: "Explorations" }).locator("> li");
    await expect(rd).toHaveCount(explorations.length);
    for (const [index, exploration] of explorations.entries()) {
      await expect(rd.nth(index).getByRole("heading", { level: 3 })).toHaveText(exploration.name);
      await expect(rd.nth(index)).toContainText(exploration.status);
      await expect(rd.nth(index)).toContainText(exploration.meaning);
    }

    const groups = page.getByRole("region", { name: "Skills" }).locator("dl > div");
    await expect(groups.locator("dt")).toHaveText(skills.map(({ label }) => label));
    await expect(groups.locator("dd")).toHaveText(skills.map(({ technologies }) => technologies));

    await expect(
      page.getByRole("list", { name: "Education" }).getByRole("heading", { level: 3 }),
    ).toHaveText([
      /^Informatics, master's degree/u,
      /^Example solutions architect/u,
      /^First agent shipped/u,
    ]);
  });

  for (const scheme of schemes) {
    test(`prints dark on white without the site's controls in ${scheme} mode`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ media: "print", colorScheme: scheme });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${website.url}/cv`);

      const colours = await page.evaluate(() => ({
        background: getComputedStyle(document.body).backgroundColor,
        text: getComputedStyle(document.querySelector("h1") ?? document.body).color,
      }));
      expect(colours).toEqual({ background: "rgb(255, 255, 255)", text: "rgb(10, 10, 10)" });
      await expect(page.getByRole("contentinfo")).toBeHidden();
      await expect(page.getByRole("link", { name: "Download CV" })).toBeHidden();
      await expect(page.locator("main time")).toBeHidden();
      // The statuses are printed as text; designed reads as unimplemented.
      const rd = page.getByRole("list", { name: "Explorations" });
      await expect(rd).toBeVisible();
      await expect(rd).toContainText("Designed");
      await expect(rd).toContainText("Unimplemented design, planned or architected only");
      // Paper cannot be clicked: a link's address is printed after its label.
      await expect(page.getByRole("list", { name: "Contacts" })).toContainText(
        "https://github.example.test/casey-morrow",
      );

      await page.screenshot({
        path: testInfo.outputPath(`cv-print-${scheme}.png`),
        fullPage: true,
      });
      await page.pdf({ path: testInfo.outputPath(`cv-print-${scheme}.pdf`), format: "A4" });
    });
  }

  test("is operable by keyboard in reading order", async ({ page }) => {
    await page.goto(`${website.url}/cv`);
    // The skip link comes first; following it starts the content's reading order.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    const names: string[] = [];
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press("Tab");
      names.push(
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText ?? ""),
      );
    }
    expect(names.map((name) => name.trim())).toEqual([
      "casey@morrow.example.test",
      "LinkedIn",
      "GitHub",
      "Download CV",
      "Built in public with an agentic engineering workflow",
      "CV",
    ]);
  });

  test("says truthfully when the PDF's file cannot be served and leads back to the CV", async ({
    page,
  }) => {
    const stored = await storedPdfs(api.storage);
    expect(stored.length).toBeGreaterThan(0);
    try {
      for (const path of stored) await rename(path, `${path}.away`);

      await page.goto(`${website.url}/experience`);
      await hydrated(page);
      await page.getByRole("link", { name: "Download CV" }).click();
      await expect(page).toHaveURL(/\/cv\/pdf\/unavailable$/u);
      await expect(page).toHaveTitle("CV PDF unavailable");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "The CV PDF could not be downloaded.",
      );
      await expect(page.locator("main")).toContainText("nothing was downloaded");
      await expect(page.getByRole("link", { name: "Read the CV" })).toHaveAttribute("href", "/cv");
      await expect(page.getByRole("link", { name: "Try the download again" })).toHaveAttribute(
        "href",
        "/cv/pdf",
      );
      await expectAccessible(page);

      await page.getByRole("link", { name: "Read the CV" }).click();
      await expect(page).toHaveURL(/\/cv$/u);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Casey Morrow");
    } finally {
      for (const path of stored) await rename(`${path}.away`, path);
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
          ["cv", "/cv"],
          ["cv-pdf-unavailable", "/cv/pdf/unavailable"],
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
        await page.goto(`${website.url}/experience`);
        await page.mouse.move(0, 0);
        await page.locator("main header").screenshot({
          path: testInfo.outputPath(`experience-header-${String(width)}-${scheme}.png`),
        });
        await page.goto(website.url);
        await page.mouse.move(0, 0);
        await page.getByRole("region", { name: "Experience", exact: true }).screenshot({
          path: testInfo.outputPath(`homepage-experience-${String(width)}-${scheme}.png`),
        });
      });
    }
  }
});

test.describe("CV without a PDF", () => {
  test("keeps the CV usable and offers the CV page instead of a download, without a date", async ({
    page,
  }) => {
    for (const path of ["/", "/experience"]) {
      await page.goto(path);
      await expect(page.getByRole("link", { name: "Download CV" })).toHaveCount(0);
      await expect(page.locator("main").getByRole("link", { name: "Read the CV" })).toHaveAttribute(
        "href",
        "/cv",
      );
      await expect(page.locator("main")).not.toContainText("PDF updated");
    }

    const response = await page.goto("/cv");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download CV" })).toHaveCount(0);
    await expect(page.locator("main time")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);

    // A stale link to the download leads to the live CV, never to a file.
    const download = await page.request.get("/cv/pdf", { maxRedirects: 0 });
    expect(download.status()).toBe(303);
    expect(download.headers()["location"]).toBe("/cv");
    await page.goto("/cv/pdf");
    await expect(page).toHaveURL(/\/cv$/u);
  });
});
