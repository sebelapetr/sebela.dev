import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { startApi, startWebsite, type Started } from "./stack";

// How the Ask page recovers when an answer fails, against the fictional person of
// e2e/fixtures/with-experience/ (Casey Morrow). The failures are the mock adapter's scenarios
// (src/modules/chat/data/mock-adapter.ts), queued through the phase 3 test seam
// `window.__sebelaMockChatScenarios`: one per question or retry, then answers are normal again.

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
const retryButton = (page: Page) => page.getByRole("button", { name: "Try again" });
const liveRegion = (page: Page) => page.locator("[role='status'][aria-live='polite']");

/** Waits until the latest answer has ended: it is no longer marked busy. */
async function answered(page: Page) {
  await expect(turns(page).last().locator("[aria-busy='false']")).toHaveCount(1);
}

/** Queues failures for the next questions or retries of this page load. */
async function queue(page: Page, ...scenarios: string[]) {
  await page.evaluate((names) => {
    window.__sebelaMockChatScenarios = names;
  }, scenarios);
}

/** Opens an empty Ask page, queues the failures and asks the question. */
async function askFailing(page: Page, url: string, question: string, ...scenarios: string[]) {
  await page.goto(`${url}/ask`);
  await hydrated(page);
  await queue(page, ...scenarios);
  await composer(page).fill(question);
  await composer(page).press("Enter");
  await expect(page).toHaveURL(conversationAddress);
}

/** Records every text the live region shows, from now on. */
async function recordAnnouncements(page: Page) {
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
}

const announced = (page: Page) =>
  page.evaluate(() => (window as unknown as { announced: string[] }).announced);

test.describe("an answer that fails", () => {
  const site = serveFixture();

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test.describe("is labelled, explained and offered again where the error allows", () => {
    const cases = [
      ["error-before-start", "Not answered", "The assistant is unavailable right now."],
      ["transport-failure", "Not answered", "The answer stopped before it finished."],
      ["interrupt", "Incomplete", "The answer stopped before it finished."],
      ["error-after-start", "Incomplete", "Something went wrong while answering."],
      ["invalid-payload", "Incomplete", "The answer could not be read."],
    ] as const;
    for (const [scenario, tag, note] of cases) {
      test(scenario, async ({ page }) => {
        await askFailing(page, site.url(), unknownQuestion, scenario);
        await answered(page);
        const answer = turns(page).last();
        await expect(answer.getByText(tag, { exact: true })).toBeVisible();
        await expect(answer.getByText(note, { exact: true })).toBeVisible();
        if (tag === "Incomplete") await expect(answer).toContainText("The assistant is");
        await expect(answer).not.toContainText(notConnected);
        await expect(answer.getByRole("list", { name: "Related pages" })).toHaveCount(0);
        // The composer is free again: the failure never blocks the next question.
        await composer(page).fill("Another fictional question?");
        await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();

        await retryButton(page).click();
        await answered(page);
        // The same question answered in place: no second question, no failure left.
        await expect(turns(page)).toHaveCount(1);
        await expect(turns(page).getByText(unknownQuestion, { exact: true })).toHaveCount(1);
        await expect(answer).toContainText(notConnected);
        await expect(answer.getByText(tag, { exact: true })).toHaveCount(0);
        await expect(retryButton(page)).toHaveCount(0);
      });
    }
  });

  test("a retry that fails again can be tried once more", async ({ page }) => {
    await askFailing(page, site.url(), unknownQuestion, "interrupt", "error-before-start");
    await answered(page);
    await retryButton(page).click();
    await answered(page);
    await expect(turns(page)).toHaveCount(1);
    await expect(turns(page).last()).toContainText("The assistant is unavailable right now.");
    await retryButton(page).click();
    await answered(page);
    await expect(turns(page).last()).toContainText(notConnected);
  });

  test("an error a retry cannot help offers none and says what to do instead", async ({ page }) => {
    await askFailing(page, site.url(), unknownQuestion, "not-retryable");
    await answered(page);
    const answer = turns(page).last();
    await expect(answer.getByText("Not answered", { exact: true })).toBeVisible();
    await expect(answer).toContainText(
      "This question could not be sent. Try asking something else.",
    );
    await expect(retryButton(page)).toHaveCount(0);
    await composer(page).fill("Another fictional question?");
    await composer(page).press("Enter");
    await expect(turns(page)).toHaveCount(2);
    await answered(page);
    await expect(turns(page).last()).toContainText(notConnected);
  });

  test("only the latest answer offers a retry", async ({ page }) => {
    await askFailing(page, site.url(), unknownQuestion, "interrupt");
    await answered(page);
    await expect(retryButton(page)).toHaveCount(1);
    await composer(page).fill("Another fictional question?");
    await composer(page).press("Enter");
    await answered(page);
    await expect(turns(page)).toHaveCount(2);
    await expect(turns(page).first()).toContainText("The answer stopped before it finished.");
    await expect(retryButton(page)).toHaveCount(0);
  });

  test("a refusal and too little evidence are final answers, each labelled, never retried", async ({
    page,
  }) => {
    await askFailing(page, site.url(), unknownQuestion, "refused");
    await answered(page);
    await expect(turns(page).last().getByText("Declined", { exact: true })).toBeVisible();
    await expect(retryButton(page)).toHaveCount(0);

    await composer(page).fill(`What are ${name}'s strongest engineering skills?`);
    await composer(page).press("Enter");
    await answered(page);
    await expect(
      turns(page).last().getByText("Not enough evidence", { exact: true }),
    ).toBeVisible();
    await expect(retryButton(page)).toHaveCount(0);
  });

  test("an answer that goes quiet times out, keeps its part and can be retried", async ({
    page,
  }) => {
    await page.clock.install();
    await askFailing(page, site.url(), unknownQuestion, "stall");
    const answer = turns(page).last();
    await expect(answer.getByText("Answering", { exact: true })).toBeVisible();
    await expect(answer).toContainText("The assistant is");
    await page.clock.fastForward(21_000);
    await answered(page);
    await expect(answer.getByText("Incomplete", { exact: true })).toBeVisible();
    await expect(answer.getByText("The answer took too long.", { exact: true })).toBeVisible();
    await retryButton(page).click();
    await answered(page);
    await expect(answer).toContainText(notConnected);
    await expect(turns(page)).toHaveCount(1);
  });

  test("an answer delivered twice shows once", async ({ page }) => {
    await askFailing(page, site.url(), unknownQuestion, "duplicates");
    await answered(page);
    const answer = turns(page).last();
    await expect(answer).toContainText(notConnected);
    expect(await answer.textContent()).not.toContain(`${notConnected}${notConnected}`);
    const text = (await answer.textContent()) ?? "";
    expect(text.split("not connected yet").length).toBe(2);
    await expect(answer.getByRole("link", { name: "Experience" })).toHaveCount(1);
  });

  test("announces the failure, the retry and its answer", async ({ page }) => {
    await page.goto(`${site.url()}/ask`);
    await hydrated(page);
    await recordAnnouncements(page);
    await queue(page, "interrupt");
    await composer(page).fill(unknownQuestion);
    await composer(page).press("Enter");
    await answered(page);
    await retryButton(page).click();
    await answered(page);
    await expect
      .poll(() => announced(page))
      .toEqual([
        "Answering…",
        "The answer stopped before it finished. You can try again.",
        "Answering…",
        expect.stringContaining(notConnected),
      ]);
  });

  test("retries with the keyboard and keeps focus at the answer", async ({ page }) => {
    await askFailing(page, site.url(), unknownQuestion, "error-after-start");
    await answered(page);
    await retryButton(page).focus();
    await expect(retryButton(page)).toBeFocused();
    await page.keyboard.press("Enter");
    const answer = turns(page).last().locator("[aria-busy]");
    await expect(answer).toBeFocused();
    await answered(page);
    await expect(answer).toBeFocused();
    await expect(answer).toContainText(notConnected);
    // Tab moves on from the answer to its related pages.
    await page.keyboard.press("Tab");
    await expect(answer.getByRole("link", { name: "Experience" })).toBeFocused();
  });

  test("reaches Try again with Tab after the composer's failure", async ({ page }) => {
    await askFailing(page, site.url(), unknownQuestion, "interrupt");
    await answered(page);
    await expect(composer(page)).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(retryButton(page)).toBeFocused();
  });

  test("keeps the composer usable on a phone after a failure", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await askFailing(page, site.url(), unknownQuestion, "error-after-start");
    await answered(page);
    await expect(composer(page)).toBeInViewport();
    await expect(retryButton(page)).toBeInViewport();
    await composer(page).fill("Another fictional question?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(turns(page)).toHaveCount(2);
    await answered(page);
    await expect(composer(page)).toBeInViewport();
    await expectNoHorizontalScroll(page);
  });
});

test.describe("stale answers and repeated sends", () => {
  const site = serveFixture();

  test("New chat during an answer ignores everything that answer still sends", async ({ page }) => {
    await askFailing(page, site.url(), unknownQuestion, "stall");
    await expect(turns(page).last()).toContainText("The assistant is");
    await page.getByRole("button", { name: "New chat" }).click();
    await expect(conversation(page)).toHaveCount(0);
    await page.getByRole("button", { name: `What is ${name} working on now?` }).click();
    await answered(page);
    await expect(turns(page)).toHaveCount(1);
    const answer = turns(page).last();
    await expect(answer).toContainText("The site keeps what");
    await expect(answer).not.toContainText("The assistant is");
  });

  test("a suggestion pressed twice is asked once", async ({ page }) => {
    await page.goto(`${site.url()}/ask`);
    await hydrated(page);
    await page.getByRole("button", { name: `What is ${name} working on now?` }).dblclick();
    await answered(page);
    await expect(turns(page)).toHaveCount(1);
  });

  test("Try again pressed twice retries once", async ({ page }) => {
    await askFailing(page, site.url(), unknownQuestion, "interrupt");
    await answered(page);
    await retryButton(page).dblclick();
    await answered(page);
    await expect(turns(page)).toHaveCount(1);
    await expect(turns(page).last()).toContainText(notConnected);
  });

  test("leaving during a failed answer and coming back sends nothing again", async ({ page }) => {
    await askFailing(page, site.url(), unknownQuestion, "error-after-start");
    await answered(page);
    const address = page.url();
    await page.getByRole("link", { name: "Experience" }).first().click();
    await expect(page).toHaveURL(/\/experience$/u);
    await page.goBack();
    await expect(page).toHaveURL(address);
    await hydrated(page);
    await expect(turns(page)).toHaveCount(1);
    await expect(turns(page).last()).toContainText("Something went wrong while answering.");
    await expect(retryButton(page)).toBeVisible();
    await page.reload();
    await hydrated(page);
    await expect(turns(page)).toHaveCount(1);
    await expect(retryButton(page)).toBeVisible();
  });

  test("a reload during an answer keeps it as interrupted and does not resend it", async ({
    page,
  }) => {
    await askFailing(page, site.url(), unknownQuestion, "stall");
    await expect(turns(page).last()).toContainText("The assistant is");
    await page.reload();
    await hydrated(page);
    await expect(turns(page)).toHaveCount(1);
    await answered(page);
    const answer = turns(page).last();
    await expect(answer.getByText("Incomplete", { exact: true })).toBeVisible();
    await expect(answer).toContainText("The answer stopped before it finished.");
    await expect(liveRegion(page)).toHaveText("");
    await retryButton(page).click();
    await answered(page);
    await expect(answer).toContainText(notConnected);
  });

  test("another tab with the same address sees none of this tab's conversation", async ({
    page,
    context,
  }) => {
    await page.goto(`${site.url()}/ask`);
    await hydrated(page);
    await composer(page).fill(unknownQuestion);
    await composer(page).press("Enter");
    await expect(page).toHaveURL(conversationAddress);
    await answered(page);
    const other = await context.newPage();
    await other.goto(page.url());
    await hydrated(other);
    await expect(other.getByRole("region", { name: "Suggested questions" })).toBeVisible();
    await expect(conversation(other)).toHaveCount(0);
    await other.close();
  });

  test("chats in a tab whose storage is blocked, keeping nothing after a reload", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "sessionStorage", {
        configurable: true,
        get() {
          throw new DOMException("Storage is blocked.", "SecurityError");
        },
      });
    });
    await page.goto(`${site.url()}/ask`);
    await hydrated(page);
    await queue(page, "interrupt");
    await composer(page).fill(unknownQuestion);
    await composer(page).press("Enter");
    await expect(page).toHaveURL(conversationAddress);
    await answered(page);
    await retryButton(page).click();
    await answered(page);
    await expect(turns(page).last()).toContainText(notConnected);
    await page.reload();
    await hydrated(page);
    await expect(page.getByRole("region", { name: "Suggested questions" })).toBeVisible();
    await expect(conversation(page)).toHaveCount(0);
  });
});

test.describe("the recovery controls' layout", () => {
  const site = serveFixture();

  for (const scheme of schemes) {
    for (const width of widths) {
      test(`fits ${String(width)} px in ${scheme} mode without violations`, async ({
        page,
      }, testInfo) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height: 900 });
        await askFailing(page, site.url(), unknownQuestion, "error-after-start", "not-retryable");
        await expectLoaded(page);
        await answered(page);
        await expectNoHorizontalScroll(page);
        await expectAccessible(page);
        const box = await retryButton(page).boundingBox();
        if (box === null) throw new Error("Try again not laid out");
        expect(box.height).toBeGreaterThanOrEqual(44);
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: testInfo.outputPath(`ask-failed-${String(width)}-${scheme}.png`),
        });
        await retryButton(page).focus();
        await page.screenshot({
          path: testInfo.outputPath(`ask-retry-focus-${String(width)}-${scheme}.png`),
        });

        // A retry that a retry cannot help, then the stall, labelled as answering.
        await retryButton(page).click();
        await answered(page);
        await expect(retryButton(page)).toHaveCount(0);
        await expectNoHorizontalScroll(page);
        await expectAccessible(page);
        await page.screenshot({
          path: testInfo.outputPath(`ask-not-retryable-${String(width)}-${scheme}.png`),
        });

        await queue(page, "stall");
        await composer(page).fill("Another fictional question?");
        await composer(page).press("Enter");
        await expect(turns(page).last().getByText("Answering", { exact: true })).toBeVisible();
        await expectAccessible(page);
        await page.screenshot({
          path: testInfo.outputPath(`ask-streaming-${String(width)}-${scheme}.png`),
        });
        await page.getByRole("button", { name: "New chat" }).click();
      });
    }
  }
});
