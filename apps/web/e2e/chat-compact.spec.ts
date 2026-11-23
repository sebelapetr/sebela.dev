import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { serveChatStack } from "./chat-stack";
import { executions, fakeTurnstile } from "./turnstile-fake";

// The composer's `/compact` over the real chat path (e2e/chat-stack.ts): the command suggestions
// by keyboard and touch, an unknown command that is never sent, a compaction with nothing to
// compact, one that runs (followed by a second tab), one that is stopped, the unchanged visible
// conversation, the usage it counts and the estimate it leaves, and an English and a Czech
// question after it. The fictional model's `slow` scenario waits for the gate in its compaction
// too, so a compaction stays open while a test looks at it. A compaction needs three exchanges;
// an identity may be admitted five times a rolling minute, so no test asks more than that. Each
// test is its own visitor at its own address. Nothing here calls a provider or Cloudflare.

const answerText = "Ilsa Marrow is a fictional engineer who builds evaluated assistants.";
const english = [
  "What does Ilsa Marrow build?",
  "Which assistants has she evaluated?",
  "How does she test them?",
];
const czech = ["Co Ilsa Marrow staví?", "Které asistenty hodnotila?", "Jak je testuje?"];
const help =
  "Summarize the assistant's current working context. History it already leaves out is not summarized again, and your visible conversation stays as it is.";
const compacting = "Compacting the working context…";
const compacted =
  "The working context was compacted. Earlier exchanges are now a summary for the assistant; your visible conversation is unchanged.";
const nothing =
  "There is nothing to compact yet. The working context is still small, so nothing was counted.";
const stopped = "Compacting was stopped. The assistant keeps its prior context.";

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
const composer = (page: Page) => page.getByRole("combobox", { name: "Your question" });
const menu = (page: Page) => page.getByRole("listbox", { name: "Commands" });
const options = (page: Page) => menu(page).getByRole("option");
const sendButton = (page: Page) => page.getByRole("button", { name: "Send" });
const stopCompacting = (page: Page) => page.getByRole("button", { name: "Stop compacting" });
const notice = (page: Page, text: string) => page.getByText(text, { exact: true });
const usagePanel = (page: Page) => page.getByRole("region", { name: "Your usage" });
const usageToggle = (page: Page) => usagePanel(page).getByRole("button", { name: /^Usage/ });

let visitors = 0;

/** Makes the page's browser context a new visitor at an address of its own (a documentation range). */
async function newVisitor(page: Page) {
  visitors += 1;
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${String(visitors)}` });
}

/** Opens the Ask page once the visitor's conversation is read. */
async function openAsk(page: Page, url: string) {
  await page.goto(`${url}/ask`);
  await hydrated(page);
  await expect(page.getByText("Loading your conversation…")).toHaveCount(0);
}

async function answered(page: Page) {
  await expect(turns(page).last().locator("[aria-busy='false']")).toHaveCount(1);
}

/** Asks each question in turn and waits for its answer; the gate must be open. */
async function converse(page: Page, questions: readonly string[]) {
  for (const question of questions) {
    await composer(page).fill(question);
    await composer(page).press("Enter");
    await expect(turns(page).last()).toContainText(question);
    await answered(page);
  }
}

/** Types the command in full and sends it with Enter. */
async function compact(page: Page) {
  await composer(page).fill("/compact");
  await composer(page).press("Enter");
}

async function expectConversation(page: Page, questions: readonly string[]) {
  await expect(turns(page)).toHaveCount(questions.length);
  for (const [index, question] of questions.entries()) {
    await expect(turns(page).nth(index)).toContainText(question);
    await expect(turns(page).nth(index)).toContainText(answerText);
  }
}

async function openUsage(page: Page) {
  if ((await usageToggle(page).getAttribute("aria-expanded")) !== "true") {
    await usageToggle(page).click();
  }
  await expect(usageToggle(page)).toHaveAttribute("aria-expanded", "true");
}

test.describe("compacting the working context over the real chat path", () => {
  const stack = serveChatStack({ scenario: "slow" });

  test.beforeEach(async ({ page }) => {
    await stack().closeGate();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await newVisitor(page);
  });

  test("a leading slash offers only /compact, by keyboard, and other text is not a command", async ({
    page,
  }) => {
    await openAsk(page, stack().url);
    const calls = (await stack().calls()).length;
    await expect(composer(page)).toHaveAttribute("aria-expanded", "false");
    await composer(page).click();
    await page.keyboard.type("/");
    await expect(menu(page)).toBeVisible();
    await expect(options(page)).toHaveCount(1);
    await expect(options(page).first()).toContainText("/compact");
    await expect(options(page).first()).toContainText(help);
    await expect(options(page).first()).toHaveAttribute("aria-selected", "true");
    await expect(composer(page)).toHaveAttribute("aria-expanded", "true");
    await expect(composer(page)).toHaveAttribute("aria-controls", "ask-commands");
    await expect(composer(page)).toHaveAttribute(
      "aria-activedescendant",
      (await options(page).first().getAttribute("id")) ?? "",
    );

    // The arrows stay on the one option; Escape closes the list and ArrowDown opens it again.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await expect(options(page).first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(composer(page)).toHaveAttribute("aria-expanded", "false");
    await expect(composer(page)).not.toHaveAttribute("aria-activedescendant", /./u);
    await page.keyboard.press("ArrowDown");
    await expect(menu(page)).toBeVisible();

    // Typing filters; nothing matches a word that is not a command, nor text after a space.
    await page.keyboard.type("co");
    await expect(options(page)).toHaveCount(1);
    await page.keyboard.type("x");
    await expect(menu(page)).toHaveCount(0);
    await composer(page).fill("/compact now");
    await expect(menu(page)).toHaveCount(0);

    // Enter on a part of the command completes it and closes the list; it does not send yet.
    await composer(page).fill("/c");
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(composer(page)).toHaveValue("/compact");
    await expect(menu(page)).toHaveCount(0);
    await expect(composer(page)).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: compacting })).toHaveCount(0);
    expect(await stack().calls()).toHaveLength(calls);

    // Leaving the input closes the list.
    await composer(page).fill("/");
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(menu(page)).toHaveCount(0);
  });

  test("an unknown command is explained and never sent; a slash inside a question is a question", async ({
    page,
  }) => {
    await openAsk(page, stack().url);
    const calls = (await stack().calls()).length;
    const redeemed = stack().redeemed().length;
    await composer(page).fill("/summarize everything");
    await composer(page).press("Enter");
    await expect(
      notice(
        page,
        "/summarize is not a command. The only command is /compact. Nothing was sent; to ask this as a question, do not start it with a slash.",
      ),
    ).toBeVisible();
    await expect(composer(page)).toHaveValue("/summarize everything");
    await composer(page).fill("/compact please");
    await sendButton(page).click();
    await expect(notice(page, "/compact takes no text after it. Nothing was sent.")).toBeVisible();
    await expect(conversation(page)).toHaveCount(0);
    expect(await executions(page)).toBe(0);
    expect(stack().redeemed()).toHaveLength(redeemed);
    expect(await stack().calls()).toHaveLength(calls);

    // Changing the text drops the explanation.
    await composer(page).fill("What does Ilsa Marrow build / design?");
    await expect(page.getByText(/is not a command|takes no text/u)).toHaveCount(0);
    await stack().openGate();
    await composer(page).press("Enter");
    await answered(page);
    await expectConversation(page, ["What does Ilsa Marrow build / design?"]);
  });

  test("a tap chooses /compact, and a small context has nothing to compact and counts nothing", async ({
    browser,
  }) => {
    const touch = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 360, height: 740 },
    });
    try {
      const page = await touch.newPage();
      await fakeTurnstile(page);
      await newVisitor(page);
      await stack().openGate();
      await openAsk(page, stack().url);
      await converse(page, [english[0] ?? ""]);
      await openUsage(page);
      await expect(usagePanel(page).getByText("1 of 10 questions", { exact: true })).toBeVisible();
      const calls = (await stack().calls()).length;

      await composer(page).tap();
      await page.keyboard.type("/");
      await options(page).first().tap();
      await expect(composer(page)).toHaveValue("/compact");
      await expect(composer(page)).toBeFocused();
      await expect(menu(page)).toHaveCount(0);
      await sendButton(page).tap();
      await expect(notice(page, nothing)).toBeVisible();
      await expect(composer(page)).toHaveValue("");
      await expectConversation(page, [english[0] ?? ""]);
      // The API answered it before any person check, quota or model call.
      expect(await stack().calls()).toHaveLength(calls);
      await expect(usagePanel(page).getByText("1 of 10 questions", { exact: true })).toBeVisible();
    } finally {
      await touch.close();
    }
  });

  test("a compaction shows progress in both tabs, keeps the conversation, counts once and leaves an estimate; English follows", async ({
    page,
    context,
  }) => {
    await stack().openGate();
    await openAsk(page, stack().url);
    await converse(page, english);
    await openUsage(page);
    await expect(usagePanel(page).getByText("3 of 10 questions", { exact: true })).toBeVisible();
    await expect(usagePanel(page).getByText("Unavailable", { exact: true }).last()).toBeVisible();
    const redeemed = stack().redeemed().length;

    await stack().closeGate();
    await compact(page);
    await expect(notice(page, compacting)).toBeVisible();
    await expect(stopCompacting(page)).toBeVisible();
    await expect(sendButton(page)).toHaveCount(0);
    await expect(composer(page)).toHaveValue("");
    // It is no question: the visible conversation stays as it was.
    await expectConversation(page, english);
    await expect(page.getByText("/compact", { exact: true })).toHaveCount(0);
    expect(stack().redeemed()).toHaveLength(redeemed + 1);

    // A second tab of the visitor follows it and cannot ask a question meanwhile.
    const second = await context.newPage();
    await fakeTurnstile(second);
    await openAsk(second, stack().url);
    await expectConversation(second, english);
    await expect(notice(second, compacting)).toBeVisible();
    await expect(stopCompacting(second)).toBeVisible();
    await composer(second).fill("Another question?");
    await composer(second).press("Enter");
    await expect(turns(second)).toHaveCount(english.length);
    expect(await executions(second)).toBe(0);

    await stack().openGate();
    for (const tab of [page, second]) {
      await expect(notice(tab, compacted)).toBeVisible();
      await expect(sendButton(tab)).toBeVisible();
      await expectConversation(tab, english);
    }
    // The compaction counted as one question and left an estimate of the next one's history.
    await expect(usagePanel(page).getByText("4 of 10 questions", { exact: true })).toBeVisible();
    await expect(usagePanel(page).getByText(/^About [\d,]+ tokens of history$/u)).toBeVisible();
    await expect(usagePanel(page).getByText(/^Measured at \d\d:\d\d UTC$/u)).toBeVisible();
    await expect(
      usagePanel(page).getByText(/tool results and evidence come on top; they are not known yet/u),
    ).toBeVisible();
    await second.close();

    // The conversation goes on after it, the summary in place of the folded exchanges.
    const before = (await stack().calls()).length;
    const followUp = "What else does she build?";
    await converse(page, [followUp]);
    await expectConversation(page, [...english, followUp]);
    await expect(page.getByText(compacted, { exact: true })).toHaveCount(0);
    const after = (await stack().calls()).slice(before);
    expect(after.length).toBeGreaterThan(0);
  });

  test("a Czech conversation is compacted and goes on in Czech", async ({ page }) => {
    await stack().openGate();
    await openAsk(page, stack().url);
    await converse(page, czech);
    await compact(page);
    await expect(notice(page, compacted)).toBeVisible();
    await expectConversation(page, czech);
    const followUp = "Co dalšího staví?";
    await converse(page, [followUp]);
    await expectConversation(page, [...czech, followUp]);
  });

  test("Stop compacting ends it, keeps the conversation and the prior context", async ({
    page,
  }) => {
    await stack().openGate();
    await openAsk(page, stack().url);
    await converse(page, english);
    await stack().closeGate();
    await compact(page);
    await expect(stopCompacting(page)).toBeVisible();
    await stopCompacting(page).click();
    await expect(notice(page, stopped)).toBeVisible();
    await expect(sendButton(page)).toBeVisible();
    await expectConversation(page, english);
    await openUsage(page);
    await expect(usagePanel(page).getByText("Unavailable", { exact: true }).last()).toBeVisible();
  });
});

test.describe("the command and compaction layout", () => {
  const stack = serveChatStack({ scenario: "slow" });

  test.beforeEach(async ({ page }) => {
    await stack().closeGate();
    await newVisitor(page);
  });

  for (const scheme of schemes) {
    test(`fits 360, 768 and 1280 px in ${scheme} mode without violations`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      const shots = async (name: string) => {
        for (const width of widths) {
          await page.setViewportSize({ width, height: width === 360 ? 740 : 900 });
          await expectNoHorizontalScroll(page);
          await page.screenshot({
            path: testInfo.outputPath(`ask-compact-${name}-${String(width)}-${scheme}.png`),
          });
        }
        await expectAccessible(page);
      };
      await page.setViewportSize({ width: 1280, height: 900 });
      await stack().openGate();
      await openAsk(page, stack().url);
      await converse(page, english);

      await composer(page).click();
      await page.keyboard.type("/");
      await expect(menu(page)).toBeVisible();
      const option = await options(page).first().boundingBox();
      if (option === null) throw new Error("option not laid out");
      expect(option.height).toBeGreaterThanOrEqual(44);
      await shots("menu");

      await composer(page).fill("/compact now");
      await composer(page).press("Enter");
      await expect(page.getByText(/takes no text after it/u)).toBeVisible();
      await shots("unknown");

      await stack().closeGate();
      await compact(page);
      await expect(stopCompacting(page)).toBeVisible();
      const stop = await stopCompacting(page).boundingBox();
      if (stop === null) throw new Error("Stop compacting not laid out");
      expect(stop.height).toBeGreaterThanOrEqual(44);
      await page.mouse.move(0, 0);
      await shots("running");

      await stack().openGate();
      await expect(notice(page, compacted)).toBeVisible();
      await openUsage(page);
      await expect(usagePanel(page).getByText(/^About [\d,]+ tokens of history$/u)).toBeVisible();
      await page.mouse.move(0, 0);
      await shots("compacted");
    });
  }
});
