import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freePort, origin, required, startApi, startWebsite, type Started } from "./stack";

// Fixture values (e2e/fixtures/*/person.json): fictional people that exist only for these tests.
const withPhoto = {
  name: "Jordan Vale",
  headline: "Fictional engineer of small, dependable web systems",
  email: "jordan@vale.example.test",
  links: [
    { label: "Website", url: "https://vale.example.test/" },
    { label: "Code", url: "https://code.example.test/jordan-vale" },
  ],
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

test.describe("homepage read from the API", () => {
  test("shows the person, the calls to action, the contact block and the footer", async ({
    page,
  }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`${withPhoto.name} — ${withPhoto.headline}`);

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toContainText(withPhoto.name);
    await expect(heading).toContainText(withPhoto.headline);
    // The short bio's Markdown renders as inline elements, never as raw syntax.
    await expect(page.locator("main strong").first()).toHaveText("fictional");
    await expect(page.getByRole("link", { name: "the example blog" })).toHaveAttribute(
      "href",
      "https://blog.example.test/",
    );

    const photo = page.getByRole("img", { name: /grey placeholder portrait/u });
    await expect(photo).toBeVisible();
    expect(await photo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(480);

    await expect(page.getByRole("link", { name: "Work with me" })).toHaveAttribute(
      "href",
      "/services",
    );
    await expect(page.getByRole("link", { name: "View my experience" })).toHaveAttribute(
      "href",
      "/experience",
    );

    const contact = page.locator("#contact");
    await expect(contact.getByRole("heading", { level: 2 })).toHaveText(
      "Have a project or a role in mind?",
    );
    await expect(contact.getByRole("link", { name: withPhoto.email })).toHaveAttribute(
      "href",
      `mailto:${withPhoto.email}`,
    );
    await expect(contact.getByRole("link", { name: "Send an email" })).toHaveAttribute(
      "href",
      `mailto:${withPhoto.email}`,
    );
    for (const link of withPhoto.links) {
      await expect(contact.getByRole("link", { name: link.label })).toHaveAttribute(
        "href",
        link.url,
      );
    }

    const footer = page.getByRole("contentinfo");
    await expect(footer).toContainText(`© ${String(new Date().getFullYear())} ${withPhoto.name}`);
    await expect(
      footer.getByRole("link", { name: "Built in public with an agentic engineering workflow" }),
    ).toHaveAttribute("href", "https://github.com/sebelapetr/sebela.dev");
    await expect(footer.getByRole("link", { name: "CV" })).toHaveAttribute("href", "/cv");
  });

  test("the contact anchor leads to the contact block", async ({ page }) => {
    await page.goto("/#contact");
    await expect(page.locator("#contact")).toBeInViewport();
  });

  test("is operable by keyboard in reading order", async ({ page }) => {
    await page.goto("/");
    const order: string[] = [];
    for (let step = 0; step < 9; step += 1) {
      await page.keyboard.press("Tab");
      order.push(
        await page.evaluate(() => {
          const element = document.activeElement;
          return element instanceof HTMLElement ? element.innerText.trim() : "";
        }),
      );
    }
    expect(order).toEqual([
      "the example blog",
      "Work with me",
      "View my experience",
      withPhoto.email,
      "Website",
      "Code",
      "Send an email",
      "Built in public with an agentic engineering workflow",
      "CV",
    ]);
    // Focus is visible on the primary call to action.
    await page.getByRole("link", { name: "Work with me" }).focus();
    const outline = await page
      .getByRole("link", { name: "Work with me" })
      .evaluate((element) => getComputedStyle(element).boxShadow);
    expect(outline).not.toBe("none");
  });

  for (const scheme of schemes) {
    for (const width of widths) {
      test(`fits ${String(width)} px in ${scheme} mode without violations`, async ({
        page,
      }, testInfo) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        await expectNoHorizontalScroll(page);
        await expectAccessible(page);
        // Touch targets: every link and button is at least 44 px tall.
        const heights = await page
          .locator("main a:not(p a), main button, footer a")
          .evaluateAll((elements) =>
            elements.map((element) => element.getBoundingClientRect().height),
          );
        for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
        await page.screenshot({
          path: testInfo.outputPath(`homepage-${String(width)}-${scheme}.png`),
          fullPage: true,
        });
      });
    }
  }
});

test.describe("homepage without a photo or an email address", () => {
  let api: Started;
  let website: Started;

  test.beforeAll(async () => {
    api = await startApi("without-photo");
    website = await startWebsite(api.url);
  });

  test.afterAll(async () => {
    await website.stop();
    await api.stop();
  });

  test("shows the initials instead of the photo and only the links to contact", async ({
    page,
  }, testInfo) => {
    await page.goto(website.url);
    await expect(page.getByTestId("portrait-fallback")).toHaveText("RA");
    await expect(page.getByRole("img")).toHaveCount(0);
    const contact = page.locator("#contact");
    await expect(contact.getByRole("link", { name: "Website" })).toBeVisible();
    await expect(contact.getByRole("link", { name: /email|mailto/u })).toHaveCount(0);
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      // Load again, so no colour transition is caught half-way.
      await page.reload();
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalScroll(page);
        await page.screenshot({
          path: testInfo.outputPath(`no-photo-${String(width)}-${scheme}.png`),
          fullPage: true,
        });
      }
    }
    await expectAccessible(page);
  });
});

test.describe("homepage while the API is unavailable", () => {
  let website: Started;
  let apiPort: number;
  let api: Started | undefined;

  test.beforeAll(async () => {
    // An address nothing listens on yet: the port was free a moment ago.
    const host = required("API_HOST");
    apiPort = await freePort(host);
    website = await startWebsite(origin(host, apiPort));
  });

  test.afterAll(async () => {
    await website.stop();
    await api?.stop();
  });

  test("says the content is unavailable instead of showing an empty profile", async ({
    page,
  }, testInfo) => {
    const response = await page.goto(website.url);
    expect(response?.status()).toBe(500);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "This page could not be loaded right now.",
    );
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.locator("#contact")).toHaveCount(0);
    await expectAccessible(page);
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      // Load again, so no colour transition is caught half-way.
      await page.reload();
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalScroll(page);
        await page.screenshot({
          path: testInfo.outputPath(`unavailable-${String(width)}-${scheme}.png`),
          fullPage: true,
        });
      }
    }
  });

  test("shows the content once the API answers and the visitor tries again", async ({ page }) => {
    await page.goto(website.url);
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    api = await startApi("with-photo", apiPort);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(withPhoto.name);
  });
});
