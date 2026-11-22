import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { serveChatStack, type ChatStack } from "./chat-stack";
import { executions, fakeTurnstile } from "./turnstile-fake";

// How the Ask page recovers when a question is not answered, over the real chat path
// (e2e/chat-stack.ts): a person check that fails, a chat that cannot be reached, a stream that
// drops, a refusal, an unavailable model, a spent budget, and a page closed or reloaded while the
// answer is prepared. The failures come from the stand-ins of Turnstile and Siteverify and from
// the fictional model's scenarios; nothing here calls a provider or Cloudflare.

const name = "Ilsa Marrow";
const answerText = "Ilsa Marrow is a fictional engineer who builds evaluated assistants.";
const question = "What does Ilsa Marrow build?";
const challengeNote = "We could not confirm that a person sent this question.";

const widths = [360, 768, 1280] as const;
const schemes = ["light", "dark"] as const;

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

const conversation = (page: Page) => page.getByRole("list", { name: "Conversation" });
const turns = (page: Page) => conversation(page).locator(":scope > li");
const composer = (page: Page) => page.getByRole("textbox", { name: "Your question" });
const retryButton = (page: Page) => page.getByRole("button", { name: "Try again" });
const contactLink = (page: Page) =>
  turns(page).last().getByRole("link", { name: "Contact", exact: true });

/** Waits until the latest answer has ended: it is no longer marked busy. */
async function answered(page: Page) {
  await expect(turns(page).last().locator("[aria-busy='false']")).toHaveCount(1);
}

/** Opens the Ask page once the visitor's conversation is read and asks the question. */
async function ask(page: Page, url: string, text = question) {
  await page.goto(`${url}/ask`);
  await hydrated(page);
  await expect(page.getByText("Loading your conversation…")).toHaveCount(0);
  await composer(page).fill(text);
  await composer(page).press("Enter");
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

/** What the stack has seen so far, to compare with after a step. */
async function counts(stack: ChatStack) {
  return { calls: (await stack.calls()).length, redeemed: stack.redeemed().length };
}

test.describe("a question the person check does not confirm", () => {
  const stack = serveChatStack();

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("a token Siteverify refuses is not answered, offers a retry and the contact, and calls no model", async ({
    page,
  }) => {
    await fakeTurnstile(page, ["fail-1"]);
    const before = await counts(stack());
    await ask(page, stack().url);
    await answered(page);
    const answer = turns(page).last();
    await expect(answer.getByText("Not answered", { exact: true })).toBeVisible();
    await expect(answer.getByText(challengeNote, { exact: true })).toBeVisible();
    await expect(contactLink(page)).toHaveAttribute("href", "/#contact");
    expect(stack().redeemed().slice(before.redeemed)).toEqual([
      expect.stringMatching(/^fail-1\./u),
    ]);
    expect((await stack().calls()).length).toBe(before.calls);
    // The composer is free again: the failure never blocks the next question.
    await composer(page).fill("Another question?");
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();

    // A retry takes a fresh token and is answered in place.
    await retryButton(page).click();
    await answered(page);
    await expect(turns(page)).toHaveCount(1);
    await expect(answer).toContainText(answerText);
    await expect(answer.getByText("Not answered", { exact: true })).toHaveCount(0);
    await expect(retryButton(page)).toHaveCount(0);
    await expect(contactLink(page)).toHaveCount(0);
    expect(stack().redeemed().slice(before.redeemed)).toHaveLength(2);
  });

  test("a check that fails in the browser sends nothing and can be tried again", async ({
    page,
  }) => {
    await fakeTurnstile(page, ["error"]);
    const before = await counts(stack());
    await ask(page, stack().url);
    await answered(page);
    await expect(turns(page).last().getByText(challengeNote, { exact: true })).toBeVisible();
    expect(await counts(stack())).toEqual(before);
    await retryButton(page).click();
    await answered(page);
    await expect(turns(page).last()).toContainText(answerText);
    expect(stack().redeemed().length - before.redeemed).toBe(1);
  });

  test("Try again pressed twice retries once", async ({ page }) => {
    await fakeTurnstile(page, ["fail-1"]);
    const before = await counts(stack());
    await ask(page, stack().url);
    await answered(page);
    await retryButton(page).dblclick();
    await answered(page);
    await expect(turns(page)).toHaveCount(1);
    await expect(turns(page).last()).toContainText(answerText);
    expect(stack().redeemed().length - before.redeemed).toBe(2);
  });

  test("announces the failure, the retry and its answer", async ({ page }) => {
    await fakeTurnstile(page, ["fail-1"]);
    await page.goto(`${stack().url}/ask`);
    await hydrated(page);
    await recordAnnouncements(page);
    await composer(page).fill(question);
    await composer(page).press("Enter");
    await answered(page);
    await retryButton(page).click();
    await answered(page);
    await expect
      .poll(() => announced(page))
      .toEqual([
        "Answering…",
        `${challengeNote} You can try again.`,
        "Answering…",
        expect.stringContaining(answerText),
      ]);
  });

  test("retries with the keyboard and keeps focus at the answer", async ({ page }) => {
    await fakeTurnstile(page, ["fail-1"]);
    await ask(page, stack().url);
    await answered(page);
    // Shift+Tab from the composer reaches the usage line, the contact link, then Try again.
    await expect(composer(page)).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: /^Usage/ })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(contactLink(page)).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(retryButton(page)).toBeFocused();
    await page.keyboard.press("Enter");
    const answer = turns(page).last().locator("[aria-busy]");
    await expect(answer).toBeFocused();
    expect(await answer.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
    await answered(page);
    await expect(answer).toBeFocused();
    await expect(answer).toContainText(answerText);
  });

  test("keeps the composer usable on a phone after a failure", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await fakeTurnstile(page, ["fail-1"]);
    await ask(page, stack().url);
    await answered(page);
    await expect(composer(page)).toBeInViewport();
    await expect(retryButton(page)).toBeInViewport();
    await composer(page).fill("Another question?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(turns(page)).toHaveCount(2);
    await answered(page);
    await expect(composer(page)).toBeInViewport();
    await expectNoHorizontalScroll(page);
  });
});

test.describe("a chat path that falters", () => {
  const stack = serveChatStack();

  test("a chat that cannot be reached says so and the retry is answered", async ({ page }) => {
    let refused = 0;
    await page.route("**/api/chat/conversation/messages", (route) => {
      refused += 1;
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "unavailable", message: "Unavailable." } }),
      });
    });
    await ask(page, stack().url);
    await answered(page);
    const answer = turns(page).last();
    await expect(answer.getByText("Not answered", { exact: true })).toBeVisible();
    await expect(
      answer.getByText("The assistant is unavailable right now.", { exact: true }),
    ).toBeVisible();
    expect(refused).toBe(1);
    await page.unroute("**/api/chat/conversation/messages");
    await retryButton(page).click();
    await answered(page);
    await expect(answer).toContainText(answerText);
  });

  test("a dropped stream is followed again and its answer shows once", async ({ page }) => {
    let dropped = 0;
    await page.route("**/api/chat/operations/*/events", (route) => {
      if (dropped > 0) return route.fallback();
      dropped += 1;
      return route.abort("connectionreset");
    });
    const before = await counts(stack());
    await ask(page, stack().url);
    await answered(page);
    expect(dropped).toBe(1);
    const answer = turns(page).last();
    await expect(answer).toContainText(answerText);
    expect((await answer.textContent())?.split(answerText).length).toBe(2);
    await expect(answer.getByText("Incomplete", { exact: true })).toHaveCount(0);
    expect(stack().redeemed().length - before.redeemed).toBe(1);
  });

  test("a question handed off from the hero in a tab whose storage is blocked is still asked", async ({
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
    await page.goto(stack().url);
    await hydrated(page);
    await page.getByRole("button", { name: "AI role fit?" }).click();
    await expect(page).toHaveURL(/\/ask$/u);
    await answered(page);
    await expect(turns(page).last()).toContainText(`Would ${name} fit an AI engineering role?`);
    await expect(turns(page).last()).toContainText(answerText);
  });
});

test.describe("an answer the assistant declines", () => {
  const stack = serveChatStack({ scenario: "refuse" });

  test("is final, labelled and never retried", async ({ page }) => {
    await ask(page, stack().url);
    await answered(page);
    const answer = turns(page).last();
    await expect(answer.getByText("Declined", { exact: true })).toBeVisible();
    await expect(retryButton(page)).toHaveCount(0);
    await expect(answer.getByRole("list", { name: "Sources", exact: true })).toHaveCount(0);
    // The model's main stage was never reached.
    expect((await stack().calls()).map((call) => call.stage)).toEqual(["security"]);
  });

  for (const scheme of schemes) {
    for (const width of widths) {
      test(`fits ${String(width)} px in ${scheme} mode`, async ({ page }, testInfo) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height: 900 });
        await ask(page, stack().url);
        await answered(page);
        await expectNoHorizontalScroll(page);
        await expectAccessible(page);
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: testInfo.outputPath(`ask-declined-${String(width)}-${scheme}.png`),
        });
      });
    }
  }
});

test.describe("an answer the model cannot give", () => {
  const stack = serveChatStack({ scenario: "fail" });

  test("is labelled unavailable, unlike a refusal", async ({ page }, testInfo) => {
    await ask(page, stack().url);
    await answered(page);
    const answer = turns(page).last();
    await expect(answer.getByText("Unavailable", { exact: true })).toBeVisible();
    await expect(answer.getByText("Declined", { exact: true })).toHaveCount(0);
    await expect(answer).toContainText("not available right now");
    await expectAccessible(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.screenshot({ path: testInfo.outputPath("ask-unavailable-360-light.png") });
  });
});

test.describe("a question when the day's budget is spent", () => {
  // Below one question's allowance: nothing can be admitted.
  const stack = serveChatStack({ dailySpendLimitMicroUsd: 10_000 });

  test("says so with the contact, offers no retry and calls no model", async ({
    page,
  }, testInfo) => {
    await ask(page, stack().url);
    await answered(page);
    const answer = turns(page).last();
    await expect(
      answer.getByText("The assistant cannot answer more questions today.", { exact: true }),
    ).toBeVisible();
    await expect(contactLink(page)).toBeVisible();
    await expect(retryButton(page)).toHaveCount(0);
    expect(await stack().calls()).toEqual([]);
    await expectAccessible(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.screenshot({ path: testInfo.outputPath("ask-budget-360-light.png") });
  });
});

test.describe("a page closed or reloaded while its answer is prepared", () => {
  // The fictional model waits for the gate, so the answer is still being prepared meanwhile.
  const stack = serveChatStack({ scenario: "slow" });

  test("completes the answer once, without a second check, submission or model call", async ({
    page,
    context,
  }) => {
    await ask(page, stack().url);
    await expect(turns(page).last()).toContainText("Answering…");
    await expect.poll(() => stack().calls()).toHaveLength(1);
    expect(stack().redeemed()).toHaveLength(1);

    // A reload follows the same answer: no new person check on the reloaded page.
    await page.reload();
    await hydrated(page);
    await expect(turns(page)).toHaveCount(1);
    await expect(turns(page).last()).toContainText("Answering…");
    expect(await executions(page)).toBe(0);

    // Closed and opened again, it is still followed. The fictional model waits inside the
    // Security call, whose attempt the agent bounds at 8 s, so the gate opens well before that.
    await page.close();
    const again = await context.newPage();
    await fakeTurnstile(again);
    await again.goto(`${stack().url}/ask`);
    await hydrated(again);
    await expect(turns(again).last()).toContainText("Answering…");

    await stack().openGate();
    await answered(again);
    await expect(turns(again)).toHaveCount(1);
    const answer = turns(again).last();
    await expect(answer).toContainText(answerText);
    expect((await answer.textContent())?.split(answerText).length).toBe(2);
    expect(await executions(again)).toBe(0);
    expect(stack().redeemed()).toHaveLength(1);
    expect((await stack().calls()).filter((call) => call.stage === "security")).toHaveLength(1);
  });
});

test.describe("the recovery controls' layout", () => {
  const stack = serveChatStack();

  for (const scheme of schemes) {
    for (const width of widths) {
      test(`fits ${String(width)} px in ${scheme} mode without violations`, async ({
        page,
      }, testInfo) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height: 900 });
        await fakeTurnstile(page, ["fail-1"]);
        await ask(page, stack().url);
        await answered(page);
        await expectNoHorizontalScroll(page);
        await expectAccessible(page);
        for (const control of [retryButton(page), contactLink(page)]) {
          const box = await control.boundingBox();
          if (box === null) throw new Error("control not laid out");
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: testInfo.outputPath(`ask-challenge-failed-${String(width)}-${scheme}.png`),
        });
        // By keyboard, so the focus ring shows: the composer, the usage line, the contact link,
        // then retry.
        await expect(composer(page)).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Shift+Tab");
        await expect(retryButton(page)).toBeFocused();
        await page.screenshot({
          path: testInfo.outputPath(`ask-retry-focus-${String(width)}-${scheme}.png`),
        });

        await retryButton(page).click();
        await expect(turns(page).last().getByText("Answering…")).toBeVisible();
        await answered(page);
        await expectAccessible(page);
      });
    }
  }
});
