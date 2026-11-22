import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { startApi, startWebsite, type Started } from "./stack";

// The site header, its mobile menu, the skip link and the theme on every current route, against
// the fictional career of e2e/fixtures/with-experience/ (Casey Morrow). Later routes render the
// same header and inherit these checks.

const name = "Casey Morrow";

/**
 * Every current route, the navigation entry it marks as current, and the name that leads home:
 * pages that read no profile (not found) say "Home".
 */
const pages = [
  { path: "/", current: name, home: name },
  { path: "/experience", current: "Experience", home: name },
  { path: "/services", current: "Services", home: name },
  { path: "/cv", current: null, home: name },
  { path: "/ai-roadmap", current: "AI Roadmap", home: name },
  { path: "/ask", current: "Ask AI", home: name },
  { path: "/missing-page", current: null, home: "Home" },
] as const;

const items = [
  { label: "Experience", href: "/experience" },
  { label: "Services", href: "/services" },
  { label: "AI Roadmap", href: "/ai-roadmap" },
  { label: "Contact", href: "/#contact" },
] as const;

const widths = [360, 768, 1280] as const;
const schemes = ["light", "dark"] as const;

/** The background colour of each theme's tokens (packages/ui globals.css). */
const background = { light: "rgb(255, 255, 255)", dark: "rgb(0, 0, 0)" } as const;

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

// Every link and button of the header and the menu is at least 44 px tall and wide
// (docs/design.md, Components).
async function expectTouchTargets(page: Page) {
  const sizes = await page
    .locator("header a, header button, dialog a, dialog button")
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.checkVisibility())
        .map((element) => {
          const box = element.getBoundingClientRect();
          return { height: box.height, width: box.width };
        }),
    );
  expect(sizes.length).toBeGreaterThan(0);
  for (const { height, width } of sizes) {
    expect(height).toBeGreaterThanOrEqual(44);
    expect(width).toBeGreaterThanOrEqual(44);
  }
}

/** Waits until the page is hydrated: Next's router then marks its history entry. */
async function hydrated(page: Page) {
  await page.waitForFunction(
    () => (window.history.state as { __NA?: boolean } | null)?.__NA === true,
  );
}

/** Collects what the page logs as an error, including React's hydration warnings. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

function bodyBackground(page: Page) {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

function colorScheme(page: Page) {
  return page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
}

/** The colour tokens of the root element, by name. */
function themeTokens(page: Page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const names = [
      "--background",
      "--foreground",
      "--card",
      "--card-foreground",
      "--primary",
      "--primary-foreground",
      "--secondary",
      "--secondary-foreground",
      "--muted",
      "--muted-foreground",
      "--accent",
      "--accent-foreground",
      "--border",
      "--input",
      "--ring",
      "--success",
      "--warning",
      "--destructive",
    ];
    return {
      ...Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()])),
      colorScheme: style.colorScheme,
    };
  });
}

function themeAttribute(page: Page) {
  return page.evaluate(() => document.documentElement.getAttribute("data-theme"));
}

function header(page: Page) {
  return page.getByRole("banner");
}

function themeToggle(page: Page) {
  return header(page).getByRole("button", { name: "Dark theme" });
}

/** Says the page shows its content, not the state for an API it could not read. */
async function expectContent(page: Page) {
  await expect(page.getByText("This page could not be loaded right now.")).toHaveCount(0);
}

let website: Started;

/**
 * Serves the fixture to the tests of one block. Each block has its own API, so its public rate
 * limit counts only that block's page views.
 */
function serveFixture() {
  let api: Started;
  test.beforeAll(async () => {
    api = await startApi("with-experience");
    website = await startWebsite(api.url);
  });
  test.afterAll(async () => {
    await website.stop();
    await api.stop();
  });
}

test.describe("navigation and theme", () => {
  test.describe("on a wide screen", () => {
    serveFixture();
    test.use({ viewport: { width: 1280, height: 800 } });

    for (const { path, current, home } of pages) {
      test(`${path} has the header, its current entry and the footer's links`, async ({ page }) => {
        const errors = collectErrors(page);
        await page.goto(`${website.url}${path}`);
        await hydrated(page);
        const nav = header(page).getByRole("navigation", { name: "Main" });
        const links = nav.getByRole("link");
        await expect(links).toHaveCount(items.length);
        for (const [index, item] of items.entries()) {
          await expect(links.nth(index)).toHaveText(item.label);
          await expect(links.nth(index)).toHaveAttribute("href", item.href);
        }
        await expect(header(page).getByRole("link", { name: home, exact: true })).toHaveAttribute(
          "href",
          "/",
        );
        await expect(header(page).getByRole("link", { name: "Ask AI" })).toHaveAttribute(
          "href",
          "/ask",
        );
        await expect(themeToggle(page)).toBeVisible();
        // The site's own code, apart from the person's profile links.
        await expect(
          header(page).getByRole("link", { name: "Source code on GitHub" }),
        ).toHaveAttribute("href", "https://github.com/sebelapetr/sebela.dev");

        await expectContent(page);
        // The open menu's copy of the links is hidden on a wide screen.
        const marked = header(page).locator('[aria-current="page"]').filter({ visible: true });
        if (current === null) {
          await expect(marked).toHaveCount(0);
        } else {
          await expect(marked).toHaveCount(1);
          await expect(marked).toHaveText(current);
        }
        // Contact is a block of the homepage, never the current page.
        await expect(nav.getByRole("link", { name: "Contact" })).not.toHaveAttribute(
          "aria-current",
          "page",
        );

        const footer = page.getByRole("contentinfo");
        await expect(
          footer.getByRole("link", {
            name: "Built in public with an agentic engineering workflow",
          }),
        ).toHaveAttribute("href", "https://github.com/sebelapetr/sebela.dev");
        await expect(footer.getByRole("link", { name: "CV" })).toHaveAttribute("href", "/cv");
        // The not-found page answers 404, which the browser logs as a failed resource.
        expect(
          errors.filter(
            (error) => !(path === "/missing-page" && error.includes("status of 404 (Not Found)")),
          ),
        ).toEqual([]);
      });
    }

    // The fixture's website has no chat relay token, as production before the chat is enabled.
    test("/ask on a website without the chat says so and asks the API nothing", async ({
      page,
    }) => {
      const chatRequests: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/chat"))
          chatRequests.push(request.url());
      });
      await page.goto(`${website.url}/ask`);
      await hydrated(page);
      await expect(page.getByText("The chat is not available right now.")).toBeVisible();
      await expect(page.getByRole("main").getByRole("link", { name: "Contact" })).toHaveAttribute(
        "href",
        "/#contact",
      );
      await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
      expect(chatRequests).toEqual([]);
    });

    for (const path of [
      "/experience",
      "/services",
      "/cv",
      "/ask",
      "/ai-roadmap",
      "/missing-page",
      "/cv/pdf/unavailable",
    ]) {
      test(`Contact on ${path} leads to the homepage's contact block below the header`, async ({
        page,
      }) => {
        await page.goto(`${website.url}${path}`);
        await hydrated(page);
        await header(page).getByRole("link", { name: "Contact" }).click();
        await expect(page).toHaveURL(`${website.url}/#contact`);
        const contact = page.locator("#contact");
        await expect(contact).toBeInViewport();
        const headerBottom = await header(page).evaluate(
          (element) => element.getBoundingClientRect().bottom,
        );
        await expect
          .poll(() => contact.evaluate((element) => element.getBoundingClientRect().top))
          .toBeGreaterThanOrEqual(headerBottom);
      });
    }

    test("the header stays at the top while the page scrolls", async ({ page }) => {
      await page.goto(`${website.url}/experience`);
      await page.mouse.wheel(0, 2000);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      const top = await header(page).evaluate((element) => element.getBoundingClientRect().top);
      expect(top).toBe(0);
    });

    test("the skip link comes first, shows when focused and moves focus into the content", async ({
      page,
    }) => {
      await page.goto(`${website.url}/services`);
      await hydrated(page);
      await page.keyboard.press("Tab");
      const skip = page.getByRole("link", { name: "Skip to content" });
      await expect(skip).toBeFocused();
      const box = await skip.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      await expect(skip).toBeInViewport();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      const inMain = await page.evaluate(() => document.activeElement?.closest("main") !== null);
      expect(inMain).toBe(true);
    });

    test("the keyboard reaches the header in reading order with visible focus", async ({
      page,
    }) => {
      await page.goto(`${website.url}/experience`);
      await hydrated(page);
      const order: string[] = [];
      for (let step = 0; step < 9; step += 1) {
        await page.keyboard.press("Tab");
        order.push(
          await page.evaluate(() => {
            const element = document.activeElement;
            if (!(element instanceof HTMLElement)) return "";
            return element.getAttribute("aria-label") ?? element.innerText.trim();
          }),
        );
        const outlined = await page.evaluate(() => {
          const element = document.activeElement;
          if (!(element instanceof HTMLElement)) return false;
          const style = getComputedStyle(element);
          return style.outlineStyle !== "none" || style.boxShadow !== "none";
        });
        expect(outlined).toBe(true);
      }
      expect(order).toEqual([
        "Skip to content",
        name,
        "Experience",
        "Services",
        "AI Roadmap",
        "Contact",
        "Ask AI",
        "Source code on GitHub",
        "Dark theme",
      ]);
    });
  });

  // The theme checks get their own API: with the route checks above they exceed the public rate
  // limit of one API.
  test.describe("theme on a wide screen", () => {
    serveFixture();
    test.use({ viewport: { width: 1280, height: 800 } });

    test("follows the system theme until the visitor chooses", async ({ page }) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(`${website.url}/`);
      await hydrated(page);
      expect(await themeAttribute(page)).toBeNull();
      await expect.poll(() => bodyBackground(page)).toBe(background.dark);
      await expect(themeToggle(page)).toHaveAttribute("aria-pressed", "true");

      await page.emulateMedia({ colorScheme: "light" });
      await expect.poll(() => bodyBackground(page)).toBe(background.light);
      await expect(themeToggle(page)).toHaveAttribute("aria-pressed", "false");
    });

    for (const system of schemes) {
      test(`keeps an explicit choice over a ${system} system across navigation and reload`, async ({
        page,
      }) => {
        const errors = collectErrors(page);
        const chosen = system === "light" ? "dark" : "light";
        await page.emulateMedia({ colorScheme: system });
        await page.goto(`${website.url}/`);
        await hydrated(page);
        await themeToggle(page).click();
        await expect.poll(() => themeAttribute(page)).toBe(chosen);
        await expect.poll(() => bodyBackground(page)).toBe(background[chosen]);
        // Native controls and scrollbars follow the choice, not the system.
        await expect.poll(() => colorScheme(page)).toBe(chosen);
        await expect(themeToggle(page)).toHaveAttribute("aria-pressed", String(chosen === "dark"));

        // Client navigation keeps it.
        await header(page).getByRole("link", { name: "Services" }).click();
        await expect(page).toHaveURL(`${website.url}/services`);
        await expect.poll(() => bodyBackground(page)).toBe(background[chosen]);

        // A reload applies it before anything of the page is parsed, so nothing flashes.
        await page.addInitScript(() => {
          const record = window as unknown as { themeBeforeBody?: string | null };
          new MutationObserver((_, observer) => {
            if (document.querySelector("body") === null) return;
            record.themeBeforeBody = document.documentElement.getAttribute("data-theme");
            observer.disconnect();
          }).observe(document, { childList: true, subtree: true });
        });
        await page.reload();
        await hydrated(page);
        expect(
          await page.evaluate(
            () => (window as unknown as { themeBeforeBody?: string | null }).themeBeforeBody,
          ),
        ).toBe(chosen);
        await expect.poll(() => bodyBackground(page)).toBe(background[chosen]);
        await expect(themeToggle(page)).toHaveAttribute("aria-pressed", String(chosen === "dark"));

        // Switching back stores the other choice.
        await themeToggle(page).click();
        await expect.poll(() => themeAttribute(page)).toBe(system);
        await page.reload();
        await expect.poll(() => bodyBackground(page)).toBe(background[system]);
        expect(errors).toEqual([]);
      });
    }

    test("an explicit dark choice gives the same tokens as a dark system", async ({ page }) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(`${website.url}/`);
      await hydrated(page);
      await expect.poll(() => bodyBackground(page)).toBe(background.dark);
      const system = await themeTokens(page);

      await page.emulateMedia({ colorScheme: "light" });
      await themeToggle(page).click();
      await expect.poll(() => themeAttribute(page)).toBe("dark");
      expect(await themeTokens(page)).toEqual(system);
    });

    test("nothing moves when reduced motion is requested", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${website.url}/`);
      await hydrated(page);
      const durations = await page
        .locator("header a, header button")
        .evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).transitionDuration),
        );
      expect(durations.length).toBeGreaterThan(0);
      for (const duration of durations) {
        for (const part of duration.split(",")) expect(parseFloat(part)).toBeLessThanOrEqual(1e-5);
      }
    });

    test("still switches the theme when the browser refuses its storage", async ({ page }) => {
      const errors = collectErrors(page);
      await page.addInitScript(() => {
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new DOMException("Storage is disabled", "SecurityError");
          },
        });
      });
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto(`${website.url}/experience`);
      await hydrated(page);
      expect(await themeAttribute(page)).toBeNull();
      await themeToggle(page).click();
      await expect.poll(() => bodyBackground(page)).toBe(background.dark);
      await expect(themeToggle(page)).toHaveAttribute("aria-pressed", "true");
      expect(errors).toEqual([]);
    });

    test("prints dark on white whatever the theme, without the header", async ({ page }) => {
      await page.goto(`${website.url}/cv`);
      await hydrated(page);
      await themeToggle(page).click();
      await expect.poll(() => bodyBackground(page)).toBe(background.dark);
      await page.emulateMedia({ media: "print" });
      await expect.poll(() => bodyBackground(page)).toBe(background.light);
      await expect(header(page)).toBeHidden();
    });
  });

  test.describe("on a narrow screen", () => {
    serveFixture();
    test.use({ viewport: { width: 360, height: 740 } });

    function menuButton(page: Page) {
      return header(page).getByRole("button", { name: "Menu", exact: true });
    }

    function menu(page: Page) {
      return page.getByRole("dialog", { name: "Menu" });
    }

    test("shows the name, Ask AI and the menu button instead of the navigation", async ({
      page,
    }) => {
      await page.goto(`${website.url}/services`);
      await hydrated(page);
      await expect(header(page).getByRole("link", { name })).toBeVisible();
      await expect(header(page).getByRole("link", { name: "Ask AI" })).toBeVisible();
      await expect(header(page).getByRole("navigation")).toBeHidden();
      await expect(themeToggle(page)).toBeHidden();
      await expect(header(page).getByRole("link", { name: "Source code on GitHub" })).toBeHidden();
      await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
      await expect(menuButton(page)).toHaveAttribute("aria-haspopup", "dialog");
      await expect(menu(page)).toBeHidden();
    });

    test("opens and closes the menu by keyboard, containing and restoring focus", async ({
      page,
    }) => {
      await page.goto(`${website.url}/services`);
      await hydrated(page);
      for (let step = 0; step < 4; step += 1) await page.keyboard.press("Tab");
      await expect(menuButton(page)).toBeFocused();
      await page.keyboard.press("Enter");

      await expect(menu(page)).toBeVisible();
      await expect(menuButton(page)).toHaveAttribute("aria-expanded", "true");
      expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
      const nav = menu(page).getByRole("navigation", { name: "Main" });
      for (const item of items) {
        await expect(nav.getByRole("link", { name: item.label })).toHaveAttribute(
          "href",
          item.href,
        );
      }
      await expect(nav.getByRole("link", { name: "Services" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(menu(page).getByRole("button", { name: "Dark theme" })).toBeVisible();
      await expect(menu(page).getByRole("link", { name: "Source code on GitHub" })).toHaveAttribute(
        "href",
        "https://github.com/sebelapetr/sebela.dev",
      );

      // Tab and Shift+Tab never leave the menu.
      for (let step = 0; step < 12; step += 1) {
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(
          true,
        );
      }
      for (let step = 0; step < 12; step += 1) {
        await page.keyboard.press("Shift+Tab");
        expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(
          true,
        );
      }

      await page.keyboard.press("Escape");
      await expect(menu(page)).toBeHidden();
      await expect(menuButton(page)).toBeFocused();
      await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
      expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");

      await page.keyboard.press("Enter");
      await expect(menu(page)).toBeVisible();
      await menu(page).getByRole("button", { name: "Close menu" }).click();
      await expect(menu(page)).toBeHidden();
      await expect(menuButton(page)).toBeFocused();
    });

    test("keeps the page behind still while the menu is open", async ({ page }) => {
      await page.goto(`${website.url}/experience`);
      await hydrated(page);
      await menuButton(page).click();
      await page.mouse.wheel(0, 1500);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await page.keyboard.press("Escape");
      await page.mouse.wheel(0, 1500);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    });

    test("Contact in the menu closes it and leads to the contact block", async ({ page }) => {
      await page.goto(`${website.url}/experience`);
      await hydrated(page);
      await menuButton(page).click();
      await menu(page).getByRole("link", { name: "Contact" }).click();
      await expect(page).toHaveURL(`${website.url}/#contact`);
      await expect(menu(page)).toBeHidden();
      await expect(page.locator("#contact")).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
    });

    test("switches the theme from the menu", async ({ page }) => {
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto(`${website.url}/`);
      await hydrated(page);
      await menuButton(page).click();
      const toggle = menu(page).getByRole("button", { name: "Dark theme" });
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => bodyBackground(page)).toBe(background.dark);
    });

    test("puts the footer's links first as full-width rows and the copyright line last", async ({
      page,
    }) => {
      await page.goto(`${website.url}/services`);
      await hydrated(page);
      const footer = page.getByRole("contentinfo");
      const repository = footer.getByRole("link", {
        name: "Built in public with an agentic engineering workflow",
      });
      const cv = footer.getByRole("link", { name: "CV" });
      const copyright = footer.getByText(`© ${String(new Date().getFullYear())} ${name}`);
      // The GitHub mark is drawn, and hidden from assistive technology.
      await expect(repository.locator("svg").first()).toHaveAttribute("aria-hidden", "true");
      await expect(cv.locator("svg")).toHaveAttribute("aria-hidden", "true");
      const [repositoryBox, cvBox, copyrightBox] = await Promise.all([
        repository.boundingBox(),
        cv.boundingBox(),
        copyright.boundingBox(),
      ]);
      if (repositoryBox === null || cvBox === null || copyrightBox === null) {
        throw new Error("footer not laid out");
      }
      // Both links span the content width, as the copyright line does, and are 44 px tall at least.
      for (const box of [repositoryBox, cvBox]) {
        expect(box.width).toBeGreaterThanOrEqual(copyrightBox.width - 1);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      expect(cvBox.y).toBeGreaterThanOrEqual(repositoryBox.y + repositoryBox.height);
      expect(copyrightBox.y).toBeGreaterThan(cvBox.y + cvBox.height);
      expect(copyrightBox.x).toBeLessThanOrEqual(repositoryBox.x + 1);
      await expectNoHorizontalScroll(page);
    });

    test("closes the menu when the screen becomes wide enough for the navigation", async ({
      page,
    }) => {
      await page.goto(`${website.url}/`);
      await hydrated(page);
      await menuButton(page).click();
      await expect(menu(page)).toBeVisible();
      await page.setViewportSize({ width: 1024, height: 740 });
      await expect(menu(page)).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
    });

    for (const scheme of schemes) {
      test(`the open menu fits in ${scheme} mode without violations`, async ({
        page,
      }, testInfo) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`${website.url}/experience`);
        await hydrated(page);
        await menuButton(page).click();
        // No hover state in the picture.
        await page.mouse.move(0, 0);
        await expect(menu(page)).toBeVisible();
        await expectNoHorizontalScroll(page);
        await expectAccessible(page);
        await expectTouchTargets(page);
        await page.screenshot({ path: testInfo.outputPath(`menu-360-${scheme}.png`) });
      });
    }
  });

  for (const scheme of schemes) {
    test.describe(`in ${scheme} mode`, () => {
      serveFixture();
      for (const width of widths) {
        test(`every route's header fits ${String(width)} px in ${scheme} mode without violations`, async ({
          page,
        }, testInfo) => {
          await page.emulateMedia({ colorScheme: scheme });
          await page.setViewportSize({ width, height: 800 });
          for (const { path } of pages) {
            await page.goto(`${website.url}${path}`);
            await hydrated(page);
            await page.mouse.move(0, 0);
            await expectContent(page);
            await expectNoHorizontalScroll(page);
            await expectAccessible(page);
            await expectTouchTargets(page);
            const slug = path === "/" ? "home" : path.slice(1);
            await page.screenshot({
              path: testInfo.outputPath(`${slug}-${String(width)}-${scheme}.png`),
            });
          }
        });
      }
    });
  }

  test.describe("with an explicit choice", () => {
    serveFixture();
    test("an explicit choice is shown in the screenshots of both themes", async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto(`${website.url}/services`);
      await hydrated(page);
      await themeToggle(page).click();
      await page.mouse.move(0, 0);
      await expectAccessible(page);
      await page.screenshot({ path: testInfo.outputPath("services-1280-chosen-dark.png") });
      await themeToggle(page).click();
      await page.mouse.move(0, 0);
      await page.screenshot({ path: testInfo.outputPath("services-1280-chosen-light.png") });
    });
  });
});
