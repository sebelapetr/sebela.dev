import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { required } from "../stack";

// The hero's question to the Ask page, against the website container of the complete stack with
// the fictional demo seed (playwright.complete-stack.config.ts). The stack runs without the AI
// service and without a person check, as production does until the chat goes live: the question is
// handed off and shown, and its turn ends with a note instead of an answer. Nothing here calls a
// model or Cloudflare; the real chat path is tested in e2e/chat.spec.ts.

const name = required("WEB_STACK_PERSON_NAME");
const question = "Which fictional planet has the calmest weather?";
/** The notes a turn may end with while the chat is not live: no person check, or no chat. */
const notAnswered =
  /We could not confirm that a person sent this question\.|The assistant is unavailable right now\./u;

const widths = [360, 768, 1280] as const;
const schemes = ["light", "dark"] as const;

/** Waits until the page is hydrated: Next's router then marks its history entry. */
async function hydrated(page: Page) {
  await page.waitForFunction(
    () => (window.history.state as { __NA?: boolean } | null)?.__NA === true,
  );
}

async function expectUsable(page: Page) {
  await expect(page.getByText("This page could not be loaded right now.")).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target) })),
  ).toEqual([]);
}

const turns = (page: Page) =>
  page.getByRole("list", { name: "Conversation" }).locator(":scope > li");
const heroInput = (page: Page) =>
  page.getByRole("textbox", { name: "Ask anything about my work, experience or skills" });

for (const scheme of schemes) {
  for (const width of widths) {
    test(`asks from the hero and is told it is not answered at ${String(width)} px in ${scheme} mode`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto("/");
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
      await expectUsable(page);
      await page.screenshot({
        path: testInfo.outputPath(`homepage-${String(width)}-${scheme}.png`),
        fullPage: true,
      });

      // The keyboard reaches the hero's input and sends the question with Enter.
      await hydrated(page);
      await heroInput(page).focus();
      await page.keyboard.type(question);
      await page.keyboard.press("Enter");

      // The hand-off address is replaced by the Ask page's own once the question is taken.
      await expect(page).toHaveURL(/\/ask$/u);
      await expect(turns(page)).toHaveCount(1);
      await expect(turns(page).first()).toContainText(question);
      await expect(turns(page).last().locator("[aria-busy='false']")).toHaveCount(1);
      await expect(turns(page).first().getByText("Not answered", { exact: true })).toBeVisible();
      await expect(turns(page).first()).toContainText(notAnswered);
      await expectUsable(page);
      // The Ask page keeps its composer in view: a viewport screenshot, not a full page.
      await page.screenshot({ path: testInfo.outputPath(`ask-${String(width)}-${scheme}.png`) });
    });
  }
}
