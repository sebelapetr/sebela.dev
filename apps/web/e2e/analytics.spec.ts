import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { startAnalyticsStub, type AnalyticsStub } from "./analytics-stub";
import { startChatStack, type ChatStack } from "./chat-stack";
import { freePort, origin, required, startApi, startWebsite, type Started } from "./stack";
import { fakeTurnstile } from "./turnstile-fake";

// The optional analytics integration against a local stand-in for Umami (e2e/analytics-stub.ts),
// never a live account, on the fictional person of e2e/fixtures/with-experience/ (Casey Morrow).

const websiteId = "0b6e1d6c-4f3a-4c8e-9d2b-7a5f3e1c2b4a";
const question = "Which fictional planet has the calmest weather?";
/** A hand-off address as the hero gives it; the Ask page resolves the visitor's own conversation. */
const handOffId = "3f2c9a4e-8b1d-4e6f-a7c5-2d9b0e1f4a6c";
const widths = [360, 768, 1280] as const;
const schemes = ["light", "dark"] as const;

interface Served {
  readonly url: string;
  readonly stub: AnalyticsStub | undefined;
}

/**
 * Serves the fixture's API and a website for one block, with analytics as `analytics` says: the
 * stand-in, the stand-in failing every send, an address nothing answers on, or nothing at all.
 * The blocks that walk the site and ask on it get the real chat path (`e2e/chat-stack.ts`, the
 * fictional model) and the Turnstile stand-in on each page; the others a website without the chat.
 */
function serve(analytics: "stub" | "failing" | "unreachable" | "invalid" | "off"): () => Served {
  const chat = analytics === "stub" || analytics === "failing" || analytics === "unreachable";
  let api: Started | undefined;
  let website: Started | undefined;
  let stack: ChatStack | undefined;
  let stub: AnalyticsStub | undefined;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    let settings: { scriptUrl: string; websiteId: string } | undefined;
    if (analytics === "stub" || analytics === "failing") {
      stub = await startAnalyticsStub({ failSend: analytics === "failing" });
      settings = { scriptUrl: stub.scriptUrl, websiteId };
    } else if (analytics === "unreachable") {
      const host = required("WEB_HOST");
      settings = { scriptUrl: `${origin(host, await freePort(host))}/script.js`, websiteId };
    } else if (analytics === "invalid") {
      stub = await startAnalyticsStub();
      settings = { scriptUrl: stub.scriptUrl, websiteId: "not-a-website-id" };
    }
    if (chat) {
      stack = await startChatStack({
        fixture: "with-experience",
        ...(settings === undefined ? {} : { analytics: settings }),
      });
    } else {
      api = await startApi("with-experience");
      website = await startWebsite(api.url, settings === undefined ? {} : { analytics: settings });
    }
  });
  test.afterAll(async () => {
    await stack?.stop();
    await website?.stop();
    await stub?.stop();
    await api?.stop();
  });
  if (chat) {
    test.beforeEach(async ({ page }) => {
      await fakeTurnstile(page);
    });
  }
  return () => {
    const url = stack?.url ?? website?.url;
    if (url === undefined) throw new Error("website not started");
    return { url, stub };
  };
}

/** Waits until the page is hydrated: Next's router then marks its history entry. */
async function hydrated(page: Page) {
  await page.waitForFunction(
    () => (window.history.state as { __NA?: boolean } | null)?.__NA === true,
  );
}

function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

const header = (page: Page) => page.getByRole("banner");
const themeToggle = (page: Page) => header(page).getByRole("button", { name: "Dark theme" });
const composer = (page: Page) => page.getByRole("combobox", { name: "Your question" });
const tracker = (page: Page) => page.locator("script[data-website-id]");

function urls(stub: AnalyticsStub): string[] {
  return stub.events().map((event) => String(event.payload["url"]));
}

/**
 * Walks the site as a visitor does: client navigation across the normal pages and to Ask, a
 * question there, the theme toggle, then full page loads of a hand-off address and of an address
 * with a query and a fragment. Returns the hand-off's identifier.
 */
async function walk(page: Page, url: string): Promise<string> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${url}/`);
  await hydrated(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const [label, path] of [
    ["Experience", "/experience"],
    ["Services", "/services"],
    ["AI Roadmap", "/ai-roadmap"],
    ["Ask AI", "/ask"],
  ] as const) {
    await header(page).getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(`${url}${path}`);
  }
  // The question is taken once the visitor's conversation is read.
  await expect(page.getByRole("region", { name: "Suggested questions" })).toBeVisible();
  await composer(page).fill(question);
  await composer(page).press("Enter");
  await expect(page.getByRole("list", { name: "Conversation" })).toContainText(question);
  await expect(page).toHaveURL(`${url}/ask`);

  const before = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  await themeToggle(page).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
    .not.toBe(before);

  await header(page).getByRole("link", { name: "Contact", exact: true }).click();
  await expect(page).toHaveURL(`${url}/#contact`);
  await page.goto(`${url}/ask?c=${handOffId}`);
  await hydrated(page);
  await page.goto(`${url}/services?utm_source=newsletter#consulting`);
  await hydrated(page);
  return handOffId;
}

test.describe("analytics through the stand-in", () => {
  const site = serve("stub");

  test("loads the tracker with automatic tracking off and reports only canonical paths", async ({
    page,
  }) => {
    const { url, stub } = site();
    if (stub === undefined) throw new Error("no stand-in");
    const errors = pageErrors(page);
    const conversation = await walk(page, url);

    // One page view per page reached; none for the conversation's query or the contact anchor's
    // fragment on their own, and no automatic full-address view from the tracker.
    const expected = [
      "/",
      "/experience",
      "/services",
      "/ai-roadmap",
      "/ask",
      "/",
      "/ask",
      "/services",
    ];
    await expect.poll(() => urls(stub)).toEqual(expected);
    await page.waitForTimeout(500);
    expect(urls(stub)).toEqual(expected);

    for (const event of stub.events()) {
      expect(event.type).toBe("event");
      expect(event.payload["website"]).toBe(websiteId);
      expect(event.payload["referrer"]).toBe("");
      expect(Object.keys(event.payload).sort()).toEqual(
        ["hostname", "language", "referrer", "screen", "title", "url", "website"].sort(),
      );
      for (const secret of [conversation, question, "?", "#", "utm_source", "c=", url]) {
        expect(String(event.payload["url"])).not.toContain(secret);
      }
      expect(event.body).not.toContain(conversation);
      expect(event.body).not.toContain(question);
      expect(event.body).not.toContain("utm_source");
    }
    await expect(tracker(page)).toHaveAttribute("src", stub.scriptUrl);
    await expect(tracker(page)).toHaveAttribute("data-website-id", websiteId);
    await expect(tracker(page)).toHaveAttribute("data-auto-track", "false");
    await expect(tracker(page)).toHaveAttribute("data-exclude-search", "true");
    await expect(tracker(page)).toHaveAttribute("data-exclude-hash", "true");

    expect(errors).toEqual([]);
  });

  test("reports only the origin of another site a visitor came from", async ({ page }) => {
    const { url, stub } = site();
    if (stub === undefined) throw new Error("no stand-in");
    const already = stub.events().length;
    await page.goto(`${url}/experience?ref=fictional#project`, {
      referer: "https://search.example.test/results?q=casey+morrow",
    });
    await hydrated(page);
    await expect.poll(() => stub.events().length).toBe(already + 1);
    const [event] = stub.events().slice(already);
    expect(event?.payload["url"]).toBe("/experience");
    expect(event?.payload["referrer"]).toBe("https://search.example.test");
    expect(event?.body).not.toContain("casey");
  });

  test("reports an address that is no page under one fixed path, never what was typed", async ({
    page,
  }) => {
    const { url, stub } = site();
    if (stub === undefined) throw new Error("no stand-in");
    const already = stub.events().length;
    const typed = "/a-private-note-for-casey";
    const response = await page.goto(`${url}${typed}?q=fictional#top`);
    expect(response?.status()).toBe(404);
    await hydrated(page);
    await expect.poll(() => stub.events().length).toBe(already + 1);
    await page.getByRole("banner").getByRole("link", { name: "Experience", exact: true }).click();
    await expect(page).toHaveURL(`${url}/experience`);
    await expect.poll(() => urls(stub).slice(already)).toEqual(["/404", "/experience"]);
    for (const event of stub.events().slice(already)) {
      expect(event.body).not.toContain("private-note");
      expect(event.body).not.toContain("fictional");
    }
  });

  test("adds nothing to see or reach with the keyboard, in every width and theme", async ({
    page,
  }, testInfo) => {
    const { url } = site();
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`${url}/ask`);
        await hydrated(page);
        await expect(tracker(page)).toHaveCount(1);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBe(0);
        await page.screenshot({
          path: testInfo.outputPath(`analytics-ask-${String(width)}-${scheme}.png`),
          fullPage: true,
        });
      }
    }
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map(({ id }) => id)).toEqual([]);
  });
});

for (const failure of ["failing", "unreachable"] as const) {
  test.describe(`analytics with a ${failure} service`, () => {
    const site = serve(failure);

    test("navigation, theme and chat keep working", async ({ page }) => {
      const { url, stub } = site();
      const errors = pageErrors(page);
      await walk(page, url);
      await expect(tracker(page)).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (stub !== undefined) await expect.poll(() => urls(stub).length).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    });
  });
}

for (const state of ["off", "invalid"] as const) {
  test.describe(`analytics ${state === "off" ? "without settings" : "with unusable settings"}`, () => {
    const site = serve(state);

    test("omits the integration entirely", async ({ page }) => {
      const { url, stub } = site();
      const requests: string[] = [];
      page.on("request", (request) => requests.push(request.url()));
      const errors = pageErrors(page);
      for (const path of ["/", "/ai-roadmap", "/ask"]) {
        const response = await page.goto(`${url}${path}`);
        expect(response?.status()).toBe(200);
        await hydrated(page);
        expect(await response?.text()).not.toContain("data-website-id");
        await expect(tracker(page)).toHaveCount(0);
        expect(await page.evaluate(() => "umami" in window)).toBe(false);
      }
      if (stub !== undefined) {
        expect(stub.scriptRequests()).toBe(0);
        expect(requests.filter((address) => address.startsWith(stub.origin))).toEqual([]);
      }
      expect(errors).toEqual([]);
    });
  });
}
