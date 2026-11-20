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
    // Served through the image optimizer (e2e/media.spec.ts checks the sources it chooses).
    await expect
      .poll(() =>
        photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    expect(await photo.evaluate((image: HTMLImageElement) => image.currentSrc)).toContain(
      "/_next/image?url=",
    );

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
    // What I do closes with one line on the open-source website and its repository.
    const whatIDo = page.getByRole("region", { name: "What I do" });
    await expect(whatIDo).toContainText(
      "This website is open source and built with an agentic engineering workflow.",
    );
    await expect(whatIDo.getByRole("link", { name: "Source code on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/sebelapetr/sebela.dev",
    );
  });

  test("the contact anchor leads to the contact block", async ({ page }) => {
    await page.goto("/#contact");
    await expect(page.locator("#contact")).toBeInViewport();
  });

  test("is operable by keyboard in reading order", async ({ page }) => {
    await page.goto("/");
    // The skip link comes first; following it starts the content's reading order.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    const order: string[] = [];
    for (let step = 0; step < 16; step += 1) {
      await page.keyboard.press("Tab");
      order.push(
        await page.evaluate(() => {
          const element = document.activeElement;
          if (element instanceof HTMLInputElement)
            return `input: ${element.labels?.[0]?.innerText ?? ""}`;
          return element instanceof HTMLElement ? element.innerText.trim() : "";
        }),
      );
    }
    // The chat entry's submit is disabled while the input is empty, so it is not reached.
    expect(order).toEqual([
      "the example blog",
      "input: Ask anything about my work, experience or skills",
      "AI role fit?",
      "What to automate?",
      "Working on now?",
      "Work with me",
      "View my experience",
      "Source code on GitHub",
      "Full experience",
      "Read the CV",
      withPhoto.email,
      "Website",
      "Code",
      "Send an email",
      "Built in public with an agentic engineering workflow",
      "CV",
    ]);
    // Focus is visible: the primary call to action shows its ring, a text link the outline.
    await page.getByRole("link", { name: "Work with me" }).focus();
    const ring = await page
      .getByRole("link", { name: "Work with me" })
      .evaluate((element) => getComputedStyle(element).boxShadow);
    expect(ring).not.toBe("none");
    await page.keyboard.press("Tab");
    const outline = await page
      .getByRole("link", { name: "View my experience" })
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return { style: style.outlineStyle, width: style.outlineWidth };
      });
    expect(outline).toEqual({ style: "solid", width: "2px" });
  });

  test("ends transitions at once when reduced motion is requested", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const duration = await page
      .getByRole("link", { name: "Work with me" })
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration));
    expect(duration).toBeLessThan(0.001);
  });

  test("places the chat entry between the bio and the calls to action", async ({ page }) => {
    await page.goto("/");
    const entry = page.getByTestId("hero-chat-entry");
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      const bio = await page.getByText("person from the website").boundingBox();
      const box = await entry.boundingBox();
      const action = await page.getByRole("link", { name: "Work with me" }).boundingBox();
      if (bio === null || box === null || action === null) throw new Error("hero not laid out");
      // One input line (48 px), one row of suggestions (44 px) and the gap between them (12 px).
      expect(Math.round(box.height)).toBe(104);
      expect(box.y).toBeGreaterThanOrEqual(bio.y + bio.height);
      expect(action.y).toBeGreaterThanOrEqual(box.y + box.height);
    }
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
        // Touch targets: every visible link, button and input is at least 44 px tall.
        const heights = await page
          .locator("main a:not(p a), main button, main input, footer a")
          .evaluateAll((elements) =>
            elements
              .filter((element) => element.checkVisibility())
              .map((element) => element.getBoundingClientRect().height),
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
    api = await startApi("with-photo", { port: apiPort });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(withPhoto.name);
  });
});
