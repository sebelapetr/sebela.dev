import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { serveChatStack } from "./chat-stack";
import { executions, fakeTurnstile } from "./turnstile-fake";

// The visitor's one conversation across reloads, tabs and browsers, over the real chat path
// (e2e/chat-stack.ts): restoring it, a hand-off address opened in another browser, a second tab
// that follows the answer the first is preparing, Stop, an explicit retry, a follow-up question
// and Clear conversation. The fictional model's `slow` scenario waits for the gate, so an answer
// stays open while a test looks at it; its Security attempt gives up after 8 s, so every wait for
// an open answer is short. Nothing here calls a provider or Cloudflare.

const answerText = "Ilsa Marrow is a fictional engineer who builds evaluated assistants.";
const question = "What does Ilsa Marrow build?";
const followUp = "Which assistants has she evaluated?";
const stoppedNote = "The answer was stopped.";

const widths = [360, 768, 1280] as const;
const schemes = ["light", "dark"] as const;

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
const sendButton = (page: Page) => page.getByRole("button", { name: "Send" });
const stopButton = (page: Page) => page.getByRole("button", { name: "Stop answering" });
const retryButton = (page: Page) => page.getByRole("button", { name: "Try again" });
const clearButton = (page: Page) =>
  page.getByRole("button", { name: "Clear conversation" }).first();
const clearDialog = (page: Page) => page.getByRole("dialog", { name: "Clear this conversation?" });
const suggestions = (page: Page) => page.getByRole("heading", { name: "Suggested questions" });

async function answered(page: Page) {
  await expect(turns(page).last().locator("[aria-busy='false']")).toHaveCount(1);
}

/** Opens the Ask page once the visitor's conversation is read. */
async function openAsk(page: Page, url: string) {
  await page.goto(`${url}/ask`);
  await hydrated(page);
  await expect(page.getByText("Loading your conversation…")).toHaveCount(0);
}

async function ask(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

test.describe("one conversation across reloads, tabs and browsers", () => {
  const stack = serveChatStack({ scenario: "slow" });

  test.beforeEach(async ({ page }) => {
    await stack().closeGate();
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("a second tab follows the open answer, cannot ask another, and either tab stops it", async ({
    page,
    context,
  }) => {
    await openAsk(page, stack().url);
    await ask(page, question);
    await expect(turns(page).last()).toContainText("Answering…");
    await expect.poll(async () => (await stack().calls()).length).toBeGreaterThan(0);
    const redeemed = stack().redeemed().length;

    const second = await context.newPage();
    await fakeTurnstile(second);
    await openAsk(second, stack().url);
    await expect(turns(second)).toHaveCount(1);
    await expect(turns(second).last()).toContainText(question);
    await expect(turns(second).last()).toContainText("Answering…");
    // The shared answer is open: the second tab offers Stop in place of Send.
    await composer(second).fill("Another question?");
    await expect(sendButton(second)).toHaveCount(0);
    await expect(stopButton(second)).toBeVisible();
    await composer(second).press("Enter");
    await expect(turns(second)).toHaveCount(1);

    await stopButton(second).click();
    for (const tab of [second, page]) {
      await answered(tab);
      await expect(turns(tab).last().getByText(stoppedNote, { exact: true })).toBeVisible();
      await expect(retryButton(tab)).toBeVisible();
      await expect(sendButton(tab)).toBeVisible();
    }
    // Stop needed no person check and sent no question.
    expect(stack().redeemed()).toHaveLength(redeemed);
    expect(await executions(second)).toBe(0);
  });

  test("a stopped answer is asked again in place with a fresh check, then a follow-up is answered", async ({
    page,
  }) => {
    await openAsk(page, stack().url);
    await ask(page, question);
    await expect(stopButton(page)).toBeVisible();
    await stopButton(page).click();
    await answered(page);
    await expect(turns(page).last().getByText(stoppedNote, { exact: true })).toBeVisible();
    const redeemed = stack().redeemed().length;

    await stack().openGate();
    await retryButton(page).click();
    await answered(page);
    await expect(turns(page)).toHaveCount(1);
    await expect(turns(page).last()).toContainText(answerText);
    await expect(turns(page).last().getByText(stoppedNote, { exact: true })).toHaveCount(0);
    expect(stack().redeemed()).toHaveLength(redeemed + 1);

    await ask(page, followUp);
    await expect(turns(page)).toHaveCount(2);
    await answered(page);
    await expect(turns(page).last()).toContainText(answerText);

    // A reload restores both questions and their answers, asking nothing again.
    const before = stack().redeemed().length;
    await page.reload();
    await hydrated(page);
    await expect(turns(page)).toHaveCount(2);
    await expect(turns(page).first()).toContainText(question);
    await expect(turns(page).last()).toContainText(followUp);
    await expect(turns(page).last()).toContainText(answerText);
    expect(stack().redeemed()).toHaveLength(before);
  });

  test("Clear conversation asks first, then empties every tab of the visitor", async ({
    page,
    context,
  }) => {
    await stack().openGate();
    await openAsk(page, stack().url);
    await ask(page, question);
    await answered(page);
    const second = await context.newPage();
    await fakeTurnstile(second);
    await openAsk(second, stack().url);
    await expect(turns(second)).toHaveCount(1);

    // Cancel and Escape delete nothing and give focus back to the button.
    await clearButton(page).click();
    await expect(clearDialog(page)).toBeVisible();
    await expect(clearDialog(page).getByRole("button", { name: "Cancel" })).toBeFocused();
    await clearDialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(clearDialog(page)).toBeHidden();
    await expect(clearButton(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(clearDialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(clearDialog(page)).toBeHidden();
    await expect(clearButton(page)).toBeFocused();
    await expect(turns(page)).toHaveCount(1);

    await clearButton(page).click();
    await clearDialog(page).getByRole("button", { name: "Clear conversation" }).click();
    await expect(suggestions(page)).toBeVisible();
    await expect(conversation(page)).toHaveCount(0);
    await expect(page.getByText("Your conversation was cleared.", { exact: true })).toBeVisible();
    // The other tab is told the conversation changed and reads it again.
    await expect(suggestions(second)).toBeVisible();
    await expect(conversation(second)).toHaveCount(0);

    await page.reload();
    await hydrated(page);
    await expect(suggestions(page)).toBeVisible();
    await expect(page.getByText(question)).toHaveCount(0);
  });

  test("a clear whose monitoring copies are still to be deleted says so, never that they are gone", async ({
    page,
  }) => {
    await stack().openGate();
    await openAsk(page, stack().url);
    await ask(page, question);
    await answered(page);
    // The stack has no monitoring service; its answer is marked pending as one with it would be.
    await page.route("**/api/chat/conversation", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      return route.fulfill({ response, json: { ...body, telemetryDeletion: "pending" } });
    });
    await clearButton(page).click();
    await clearDialog(page).getByRole("button", { name: "Clear conversation" }).click();
    await expect(
      page.getByText(
        "Your conversation was cleared. Copies kept for monitoring the assistant are scheduled for deletion and are not deleted yet.",
        { exact: true },
      ),
    ).toBeVisible();
    // The next question drops the notice.
    await ask(page, question);
    await expect(page.getByText(/scheduled for deletion/u)).toHaveCount(0);
    await answered(page);
  });

  test("a hand-off address opened in another browser shows that browser's own conversation", async ({
    page,
    browser,
  }) => {
    await stack().openGate();
    await page.goto(stack().url);
    await hydrated(page);
    await page
      .getByRole("textbox", { name: "Ask anything about my work, experience or skills" })
      .fill(question);
    const handOffs: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame() && frame.url().includes("?c=")) handOffs.push(frame.url());
    });
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await answered(page);
    await expect(turns(page).last()).toContainText(answerText);
    const [handOff] = handOffs;
    if (handOff === undefined) throw new Error("the home page did not hand off to /ask?c=");

    const other = await browser.newContext();
    try {
      const foreign = await other.newPage();
      await fakeTurnstile(foreign);
      const redeemed = stack().redeemed().length;
      await foreign.goto(handOff);
      await hydrated(foreign);
      await expect(suggestions(foreign)).toBeVisible();
      await expect(foreign.getByText(question)).toHaveCount(0);
      await expect(foreign.getByRole("button", { name: "Clear conversation" })).toHaveCount(0);
      expect(stack().redeemed()).toHaveLength(redeemed);
    } finally {
      await other.close();
    }
  });
});

test.describe("the lifecycle controls' layout", () => {
  const stack = serveChatStack({ scenario: "slow" });

  test.beforeEach(async () => {
    await stack().closeGate();
  });

  for (const scheme of schemes) {
    for (const width of widths) {
      test(`fits ${String(width)} px in ${scheme} mode without violations`, async ({
        page,
      }, testInfo) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.setViewportSize({ width, height: 900 });
        const shot = (name: string) =>
          page.screenshot({
            path: testInfo.outputPath(`ask-${name}-${String(width)}-${scheme}.png`),
          });
        await openAsk(page, stack().url);
        await ask(page, question);
        await expect(stopButton(page)).toBeVisible();
        await expectNoHorizontalScroll(page);
        await expectAccessible(page);
        for (const control of [stopButton(page), clearButton(page)]) {
          const box = await control.boundingBox();
          if (box === null) throw new Error("control not laid out");
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
        await page.mouse.move(0, 0);
        await shot("answering");

        await stopButton(page).click();
        await answered(page);
        await expect(turns(page).last().getByText(stoppedNote, { exact: true })).toBeVisible();
        await expectAccessible(page);
        await shot("stopped");

        await page.route("**/api/chat/conversation", async (route) => {
          if (route.request().method() !== "DELETE") return route.fallback();
          const response = await route.fetch();
          const body = (await response.json()) as Record<string, unknown>;
          return route.fulfill({ response, json: { ...body, telemetryDeletion: "pending" } });
        });
        await clearButton(page).click();
        await expect(clearDialog(page)).toBeVisible();
        await expectAccessible(page);
        await shot("clear-dialog");
        await clearDialog(page).getByRole("button", { name: "Clear conversation" }).click();
        await expect(suggestions(page)).toBeVisible();
        await expect(page.getByText(/scheduled for deletion/u)).toBeVisible();
        await expectNoHorizontalScroll(page);
        await expectAccessible(page);
        await shot("cleared");
      });
    }
  }
});
