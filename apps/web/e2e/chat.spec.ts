import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { startApi, startWebsite, type Started } from "./stack";

// The hero's chat entry and the Ask page's chat over the mock adapter, against the fictional
// person of e2e/fixtures/with-experience/ (Casey Morrow). Answers are the prepared ones of the chat
// module (src/modules/chat/data/prepared-answers.ts); nothing here calls a model.

const name = "Casey Morrow";
const unknownQuestion = "Which fictional planet has the calmest weather?";
const notConnected = "The assistant is not connected yet, so I can't answer that question.";
const conversationAddress =
  /\/ask\?c=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const widths = [360, 768, 1280] as const;
const schemes = ["light", "dark"] as const;

/** Serves the fixture's API and the website for the tests of one block, within the rate limit. */
function serveFixture(): { readonly url: () => string } {
  let api: Started | undefined;
  let website: Started | undefined;
  test.beforeAll(async () => {
    api = await startApi("with-experience");
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

async function expectLoaded(page: Page) {
  await expect(page.getByText("This page could not be loaded right now.")).toHaveCount(0);
}

const conversation = (page: Page) => page.getByRole("list", { name: "Conversation" });
const turns = (page: Page) => conversation(page).locator(":scope > li");
const composer = (page: Page) => page.getByRole("textbox", { name: "Your question" });
const heroInput = (page: Page) =>
  page.getByRole("textbox", { name: "Ask anything about my work, experience or skills" });

/** Waits until the latest answer has ended: it is no longer marked busy. */
async function answered(page: Page) {
  await expect(turns(page).last().locator("[aria-busy='false']")).toHaveCount(1);
}

test.describe("asking from the hero", () => {
  const site = serveFixture();

  test("a typed question opens its conversation on the Ask page without the text in the address", async ({
    page,
  }) => {
    await page.goto(site.url());
    await hydrated(page);
    await heroInput(page).fill(unknownQuestion);
    await page.getByRole("button", { name: "Ask", exact: true }).click();

    await expect(page).toHaveURL(conversationAddress);
    expect(page.url()).not.toContain("planet");
    await expect(turns(page)).toHaveCount(1);
    await expect(turns(page).first()).toContainText(unknownQuestion);
    await answered(page);
    const answer = turns(page).first();
    await expect(answer).toContainText(notConnected);
    const related = answer.getByRole("list", { name: "Related pages" });
    await expect(related.getByRole("link", { name: "Experience" })).toHaveAttribute(
      "href",
      "/experience",
    );
    await expect(related.getByRole("link", { name: "Services" })).toHaveAttribute(
      "href",
      "/services",
    );
  });

  test("a suggested question is sent at once and answered from the prepared answers", async ({
    page,
  }) => {
    await page.goto(site.url());
    await hydrated(page);
    const suggestions = page.getByRole("list", { name: "Suggested questions" });
    await expect(suggestions.getByRole("button").filter({ visible: true })).toHaveCount(3);
    const suggestion = suggestions.getByRole("button", { name: "AI role fit?" });
    await expect(suggestion).toHaveAccessibleDescription(
      `Would ${name} fit an AI engineering role?`,
    );
    await suggestion.click();

    await expect(page).toHaveURL(conversationAddress);
    await expect(turns(page).first()).toContainText(`Would ${name} fit an AI engineering role?`);
    await answered(page);
    await expect(turns(page).first()).toContainText("The experience page lists each position");
    await expect(turns(page).first().getByRole("link", { name: "CV" })).toHaveAttribute(
      "href",
      "/cv",
    );
  });

  test("shows two suggestions on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(site.url());
    const suggestions = page.getByRole("list", { name: "Suggested questions" });
    await expect(suggestions.getByRole("button").filter({ visible: true })).toHaveCount(2);
  });

  test("sends a question once however often it is pressed", async ({ page }) => {
    await page.goto(site.url());
    await hydrated(page);
    const suggestion = page.getByRole("button", { name: "What to automate?" });
    await suggestion.dblclick();
    await expect(page).toHaveURL(conversationAddress);
    await answered(page);
    await expect(turns(page)).toHaveCount(1);
  });

  test("back, forward and reload show the conversation without sending it again", async ({
    page,
  }) => {
    await page.goto(site.url());
    await hydrated(page);
    await page.getByRole("button", { name: "Working on now?" }).click();
    await expect(page).toHaveURL(conversationAddress);
    await answered(page);
    const address = page.url();

    await page.goBack();
    await expect(heroInput(page)).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(address);
    await expect(turns(page)).toHaveCount(1);
    await answered(page);

    await page.reload();
    await hydrated(page);
    await expect(turns(page)).toHaveCount(1);
    await expect(turns(page).first()).toContainText("The site keeps what");

    // The hero still works after coming back to it.
    await page.goBack();
    await hydrated(page);
    await page.getByRole("button", { name: "AI role fit?" }).click();
    await expect(page).toHaveURL(conversationAddress);
    expect(page.url()).not.toBe(address);
    await expect(turns(page)).toHaveCount(1);
  });

  test("reaches the input and sends with the keyboard", async ({ page }) => {
    await page.goto(site.url());
    await hydrated(page);
    await heroInput(page).focus();
    await page.keyboard.type("What is Casey Morrow working on now?");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(conversationAddress);
    await answered(page);
    await expect(turns(page).first()).toContainText("independent R&D");
  });
});

test.describe("the Ask page", () => {
  const site = serveFixture();

  test("an empty chat says what it is and offers four questions, one per kind of visitor", async ({
    page,
  }) => {
    const response = await page.goto(`${site.url()}/ask`);
    expect(response?.status()).toBe(200);
    await expectLoaded(page);
    await expect(page).toHaveTitle("Ask AI");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/u);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ask my AI");
    // An assistant over the public profile, never the person.
    await expect(page.getByText(`It is not ${name}.`)).toBeVisible();
    const suggestions = page.getByRole("region", { name: "Suggested questions" });
    await expect(suggestions.getByRole("button")).toHaveText([
      `Would ${name} fit an AI engineering role?`,
      `What could ${name} automate for my company?`,
      `What are ${name}'s strongest engineering skills?`,
      `What is ${name} working on now?`,
    ]);
    await expect(page.getByRole("button", { name: "New chat" })).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);
  });

  test("a question streams its answer and gets an address; New chat clears it", async ({
    page,
  }) => {
    await page.goto(`${site.url()}/ask`);
    await hydrated(page);
    await composer(page).fill(unknownQuestion);
    await composer(page).press("Enter");
    await expect(page).toHaveURL(conversationAddress);
    const address = page.url();
    // Busy while answering: another question cannot be sent.
    await composer(page).fill("And another one?");
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
    await answered(page);
    await expect(turns(page).first()).toContainText(notConnected);
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();

    await page.getByRole("button", { name: "New chat" }).click();
    await expect(page).toHaveURL(/\/ask$/u);
    await expect(conversation(page)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Suggested questions" })).toBeVisible();
    await expect(composer(page)).toBeFocused();

    // The cleared conversation is gone from this tab.
    await page.goto(address);
    await hydrated(page);
    await expect(page.getByRole("region", { name: "Suggested questions" })).toBeVisible();
    await expect(conversation(page)).toHaveCount(0);
  });

  test("continues a conversation with a second question", async ({ page }) => {
    await page.goto(`${site.url()}/ask`);
    await hydrated(page);
    await page
      .getByRole("button", { name: `What are ${name}'s strongest engineering skills?` })
      .click();
    await answered(page);
    await expect(turns(page).first()).toContainText("I don't have enough evidence");
    const address = page.url();
    await composer(page).fill(unknownQuestion);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(turns(page)).toHaveCount(2);
    await answered(page);
    expect(page.url()).toBe(address);
  });

  test("an unknown or malformed address opens an empty chat", async ({ page }) => {
    await page.goto(`${site.url()}/ask?c=00000000-0000-4000-8000-000000000000`);
    await hydrated(page);
    await expect(page.getByRole("region", { name: "Suggested questions" })).toBeVisible();
    await page.goto(`${site.url()}/ask?c=not-a-conversation`);
    await hydrated(page);
    await expect(page.getByRole("region", { name: "Suggested questions" })).toBeVisible();
  });

  test("announces an answer when it starts and once when it ends, not piece by piece", async ({
    page,
  }) => {
    await page.goto(`${site.url()}/ask`);
    await hydrated(page);
    await page.evaluate(() => {
      const region = document.querySelector("[role='status'][aria-live='polite']");
      if (region === null) throw new Error("no live region");
      const seen: string[] = [];
      (window as unknown as { announced: string[] }).announced = seen;
      new MutationObserver(() => {
        const text = region.textContent;
        if (seen.at(-1) !== text) seen.push(text);
      }).observe(region, { childList: true, subtree: true, characterData: true });
    });
    await page.getByRole("button", { name: `What is ${name} working on now?` }).click();
    await answered(page);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { announced: string[] }).announced))
      .toEqual(["Answering…", expect.stringContaining("The site keeps what")]);
  });

  test("keeps the composer at the bottom of a phone's screen", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(`${site.url()}/ask`);
    await hydrated(page);
    for (const question of [unknownQuestion, "Another fictional question?"]) {
      await composer(page).fill(question);
      await composer(page).press("Enter");
      await answered(page);
    }
    const box = await composer(page).boundingBox();
    if (box === null) throw new Error("composer not laid out");
    expect(box.y + box.height).toBeLessThanOrEqual(640);
    expect(box.y + box.height).toBeGreaterThan(640 - 120);
    await expect(composer(page)).toBeInViewport();
    await expectNoHorizontalScroll(page);
  });
});

test.describe("the chat's layout", () => {
  const site = serveFixture();

  for (const scheme of schemes) {
    for (const width of widths) {
      test(`fits ${String(width)} px in ${scheme} mode without violations`, async ({
        page,
      }, testInfo) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height: 900 });

        await page.goto(site.url());
        await hydrated(page);
        await expectLoaded(page);
        await expectNoHorizontalScroll(page);
        await page.getByTestId("hero-chat-entry").screenshot({
          path: testInfo.outputPath(`hero-chat-${String(width)}-${scheme}.png`),
        });
        await page.screenshot({
          path: testInfo.outputPath(`hero-${String(width)}-${scheme}.png`),
        });

        await page.goto(`${site.url()}/ask`);
        await hydrated(page);
        await expectLoaded(page);
        await expectNoHorizontalScroll(page);
        await expectAccessible(page);
        await page.screenshot({
          path: testInfo.outputPath(`ask-empty-${String(width)}-${scheme}.png`),
        });

        await page
          .getByRole("button", { name: `Would ${name} fit an AI engineering role?` })
          .click();
        await answered(page);
        await expectNoHorizontalScroll(page);
        await expectAccessible(page);
        const heights = await page
          .locator("main a:not(p a), main button, main input")
          .evaluateAll((elements) =>
            elements
              .filter((element) => element.checkVisibility())
              .map((element) => element.getBoundingClientRect().height),
          );
        for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
        await page.screenshot({
          path: testInfo.outputPath(`ask-answered-${String(width)}-${scheme}.png`),
        });
      });
    }
  }
});
