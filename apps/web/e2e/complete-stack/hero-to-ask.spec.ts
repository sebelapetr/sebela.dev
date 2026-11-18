import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { required } from "../stack";

// The hero's question to the mock Ask page, against the website container of the complete stack
// with the fictional demo seed (playwright.complete-stack.config.ts). Answers are the prepared ones
// of the chat module; nothing here calls a model.

const name = required("WEB_STACK_PERSON_NAME");
const question = "Which fictional planet has the calmest weather?";
const notConnected = "The assistant is not connected yet, so I can't answer that question.";
const conversationAddress =
  /\/ask\?c=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

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
    test(`asks from the hero and reads the mock answer at ${String(width)} px in ${scheme} mode`, async ({
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

      await expect(page).toHaveURL(conversationAddress);
      expect(page.url()).not.toContain("planet");
      await expect(turns(page)).toHaveCount(1);
      await expect(turns(page).first()).toContainText(question);
      await expect(turns(page).last().locator("[aria-busy='false']")).toHaveCount(1);
      await expect(turns(page).first()).toContainText(notConnected);
      await expectUsable(page);
      // The Ask page keeps its composer in view: a viewport screenshot, not a full page.
      await page.screenshot({ path: testInfo.outputPath(`ask-${String(width)}-${scheme}.png`) });
    });
  }
}
