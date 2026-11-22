import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";

import { expect, request as requests, test, type Page } from "@playwright/test";

import { serveChatStack } from "./chat-stack";
import { fakeTurnstile } from "./turnstile-fake";

// The hero's chat entry and the Ask page's chat over the real chat path: the website's chat
// routes, the API with the visitor's cookie and the person check, and the AI service with its
// fictional model (e2e/chat-stack.ts). The person is the agent evals' fictional profile (Ilsa
// Marrow); nothing here calls a provider or Cloudflare.

const name = "Ilsa Marrow";
const answerText = "Ilsa Marrow is a fictional engineer who builds evaluated assistants.";
const question = "What does Ilsa Marrow build?";
const storageNotice =
  "This conversation is stored for 730 days after its last activity, so you can come back to it in this browser.";
const handOffAddress =
  /\/ask\?c=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const askAddress = /\/ask$/u;

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

async function expectLoaded(page: Page) {
  await expect(page.getByText("This page could not be loaded right now.")).toHaveCount(0);
}

const conversation = (page: Page) => page.getByRole("list", { name: "Conversation" });
const turns = (page: Page) => conversation(page).locator(":scope > li");
const composer = (page: Page) => page.getByRole("textbox", { name: "Your question" });
const heroInput = (page: Page) =>
  page.getByRole("textbox", { name: "Ask anything about my work, experience or skills" });
const suggestionsRegion = (page: Page) => page.getByRole("region", { name: "Suggested questions" });

/** Waits until the latest answer has ended: it is no longer marked busy. */
async function answered(page: Page) {
  await expect(turns(page).last().locator("[aria-busy='false']")).toHaveCount(1);
}

/** Opens the Ask page once the visitor's conversation is read. */
async function openAsk(page: Page, url: string) {
  await page.goto(`${url}/ask`);
  await hydrated(page);
  await expect(page.getByText("Loading your conversation…")).toHaveCount(0);
}

async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

/** Every address the page visits from now on. */
function addresses(page: Page): string[] {
  const seen: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) seen.push(frame.url());
  });
  return seen;
}

test.describe("asking from the hero", () => {
  const stack = serveChatStack();

  test("a typed question is handed to the Ask page without the text in the address and answered", async ({
    page,
  }) => {
    const seen = addresses(page);
    await page.goto(stack().url);
    await hydrated(page);
    await heroInput(page).fill(question);
    await page.getByRole("button", { name: "Ask", exact: true }).click();

    await expect(page).toHaveURL(askAddress);
    expect(seen.some((address) => handOffAddress.test(address))).toBe(true);
    for (const address of seen) expect(address).not.toContain("build");
    await expect(turns(page)).toHaveCount(1);
    await expect(turns(page).first()).toContainText(question);
    await answered(page);
    await expect(turns(page).first()).toContainText(answerText);
    await expect(
      turns(page).first().getByRole("list", { name: "Sources", exact: true }).getByRole("link"),
    ).toHaveAttribute("href", "/");
  });

  test("a suggested question is sent at once", async ({ page }) => {
    await page.goto(stack().url);
    await hydrated(page);
    const suggestions = page.getByRole("list", { name: "Suggested questions" });
    await expect(suggestions.getByRole("button").filter({ visible: true })).toHaveCount(3);
    const suggestion = suggestions.getByRole("button", { name: "AI role fit?" });
    await expect(suggestion).toHaveAccessibleDescription(
      `Would ${name} fit an AI engineering role?`,
    );
    await suggestion.click();

    await expect(page).toHaveURL(askAddress);
    await expect(turns(page).first()).toContainText(`Would ${name} fit an AI engineering role?`);
    await answered(page);
    await expect(turns(page).first()).toContainText(answerText);
  });

  test("shows two suggestions on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(stack().url);
    const suggestions = page.getByRole("list", { name: "Suggested questions" });
    await expect(suggestions.getByRole("button").filter({ visible: true })).toHaveCount(2);
  });

  test("sends a question once however often it is pressed", async ({ page }) => {
    const before = stack().redeemed().length;
    await page.goto(stack().url);
    await hydrated(page);
    await page.getByRole("button", { name: "What to automate?" }).dblclick();
    await expect(page).toHaveURL(askAddress);
    await answered(page);
    await expect(turns(page)).toHaveCount(1);
    expect(stack().redeemed().length - before).toBe(1);
  });

  test("back, forward and reload show the conversation without asking again", async ({ page }) => {
    await page.goto(stack().url);
    await hydrated(page);
    await page.getByRole("button", { name: "Working on now?" }).click();
    await expect(page).toHaveURL(askAddress);
    await answered(page);
    const redeemed = stack().redeemed().length;
    const calls = (await stack().calls()).length;

    await page.goBack();
    await expect(heroInput(page)).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(askAddress);
    await expect(turns(page)).toHaveCount(1);
    await answered(page);

    await page.reload();
    await hydrated(page);
    await expect(turns(page)).toHaveCount(1);
    await expect(turns(page).first()).toContainText(answerText);
    expect(stack().redeemed().length).toBe(redeemed);
    expect((await stack().calls()).length).toBe(calls);

    // The hero still works after coming back to it, and continues the same conversation.
    await page.goto(stack().url);
    await hydrated(page);
    await page.getByRole("button", { name: "AI role fit?" }).click();
    await expect(page).toHaveURL(askAddress);
    await expect(turns(page)).toHaveCount(2);
    await answered(page);
  });

  test("reaches the input and sends with the keyboard", async ({ page }) => {
    await page.goto(stack().url);
    await hydrated(page);
    await heroInput(page).focus();
    await page.keyboard.type(`What is ${name} working on now?`);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(askAddress);
    await answered(page);
    await expect(turns(page).first()).toContainText(answerText);
  });
});

test.describe("the Ask page", () => {
  const stack = serveChatStack();

  test("an empty chat says what it is, how long it is kept, and offers four questions", async ({
    page,
  }) => {
    const response = await page.goto(`${stack().url}/ask`);
    expect(response?.status()).toBe(200);
    await expectLoaded(page);
    await expect(page).toHaveTitle("Ask AI");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/u);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ask my AI");
    // An assistant over the public profile, never the person.
    await expect(page.getByText(`It is not ${name}.`)).toBeVisible();
    await expect(page.getByText(storageNotice)).toBeVisible();
    await expect(suggestionsRegion(page).getByRole("button")).toHaveText([
      `Would ${name} fit an AI engineering role?`,
      `What could ${name} automate for my company?`,
      `What are ${name}'s strongest engineering skills?`,
      `What is ${name} working on now?`,
    ]);
    await expect(page.getByRole("button", { name: "New chat" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show earlier messages" })).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);
  });

  test("a question streams its answer while another cannot be sent", async ({ page }) => {
    await openAsk(page, stack().url);
    await send(page, question);
    await expect(page).toHaveURL(askAddress);
    await composer(page).fill("And another one?");
    // While the answer is open, Stop takes the place of Send and Enter sends nothing.
    await expect(page.getByRole("button", { name: "Send" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Stop answering" })).toBeVisible();
    await composer(page).press("Enter");
    await answered(page);
    await expect(turns(page)).toHaveCount(1);
    await expect(turns(page).first()).toContainText(answerText);
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  test("closing and reopening the page restores the conversation and a follow-up uses it", async ({
    page,
    context,
  }) => {
    await openAsk(page, stack().url);
    await send(page, question);
    await answered(page);
    await page.close();

    const again = await context.newPage();
    await fakeTurnstile(again);
    await openAsk(again, stack().url);
    await expect(turns(again)).toHaveCount(1);
    await expect(turns(again).first()).toContainText(answerText);
    await expect(suggestionsRegion(again)).toHaveCount(0);

    await send(again, "And what does she work on now?");
    await expect(turns(again)).toHaveCount(2);
    await answered(again);
    // The follow-up's answer was given the earlier exchange.
    const main = (await stack().calls()).filter((call) => call.stage === "main");
    expect(main.at(-1)?.history).toBeGreaterThanOrEqual(1);
  });

  test("an address never opens anyone's conversation: the caller's own is shown", async ({
    page,
    browser,
  }) => {
    await openAsk(page, stack().url);
    await send(page, question);
    await answered(page);

    for (const address of [
      "/ask?c=00000000-0000-4000-8000-000000000000",
      "/ask?c=not-a-conversation",
    ]) {
      await page.goto(`${stack().url}${address}`);
      await hydrated(page);
      await expect(turns(page)).toHaveCount(1);
      await expect(turns(page).first()).toContainText(question);
    }

    // Another visitor at the same address sees an empty chat of their own.
    const other = await browser.newContext();
    try {
      const stranger = await other.newPage();
      await fakeTurnstile(stranger);
      await stranger.goto(page.url());
      await hydrated(stranger);
      await expect(suggestionsRegion(stranger)).toBeVisible();
      await expect(conversation(stranger)).toHaveCount(0);
    } finally {
      await other.close();
    }
  });

  test("announces an answer when it starts and once when it ends, not piece by piece", async ({
    page,
  }) => {
    await openAsk(page, stack().url);
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
      .toEqual(["Answering…", expect.stringContaining(answerText)]);
  });

  test("keeps the composer at the bottom of a phone's screen", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await openAsk(page, stack().url);
    for (const text of [question, "And what does she work on now?"]) {
      await send(page, text);
      await answered(page);
    }
    const box = await composer(page).boundingBox();
    if (box === null) throw new Error("composer not laid out");
    expect(box.y + box.height).toBeLessThanOrEqual(640);
    expect(box.y + box.height).toBeGreaterThan(640 - 120);
    await expect(composer(page)).toBeInViewport();
    await expectNoHorizontalScroll(page);
  });

  test("keeps the profile note out of the composer, below the chat and above the footer", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await openAsk(page, stack().url);
    const note = page.getByText(
      `Answers are generated from ${name}'s public profile and may be incomplete.`,
    );
    const form = page.getByRole("form", { name: "Ask a question" });
    // Not part of the sticky composer: it scrolls with the page.
    expect(
      await form.evaluate(
        (element) => element.parentElement?.textContent.includes("Answers are generated") ?? true,
      ),
    ).toBe(false);
    await send(page, question);
    await answered(page);
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await expect(note).toBeInViewport();
    const [formBox, noteBox, footerBox] = await Promise.all([
      form.boundingBox(),
      note.boundingBox(),
      page.getByRole("contentinfo").boundingBox(),
    ]);
    if (formBox === null || noteBox === null || footerBox === null) throw new Error("not laid out");
    expect(noteBox.y).toBeGreaterThanOrEqual(formBox.y + formBox.height);
    expect(footerBox.y).toBeGreaterThanOrEqual(noteBox.y + noteBox.height);
  });

  test("a long question on a phone wraps, and the latest answer and the composer stay reachable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await openAsk(page, stack().url);
    const long = `${"A rather long fictional question about the engineering work of Ilsa Marrow ".repeat(6)}?`;
    await send(page, long);
    await answered(page);
    await expectNoHorizontalScroll(page);
    await expect(turns(page).last()).toContainText("A rather long fictional question");
    // The composer keeps the focus after sending, ready for the next question.
    await expect(composer(page)).toBeFocused();
    // An open on-screen keyboard shrinks the visible height; the composer stays in view.
    await page.setViewportSize({ width: 360, height: 320 });
    await expect(composer(page)).toBeInViewport();
    await expectNoHorizontalScroll(page);
  });

  test("shows earlier messages a page at a time", async ({ page }) => {
    // One exchange a page, so two exchanges make two pages.
    await page.route("**/api/chat/conversation*", (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== "GET" || !url.pathname.endsWith("/conversation")) {
        return route.fallback();
      }
      url.searchParams.set("limit", "2");
      return route.fallback({ url: url.toString() });
    });
    await openAsk(page, stack().url);
    await send(page, question);
    await answered(page);
    await send(page, "And what does she work on now?");
    await answered(page);

    await page.reload();
    await hydrated(page);
    await expect(turns(page)).toHaveCount(1);
    await expect(turns(page).first()).toContainText("And what does she work on now?");
    const earlier = page.getByRole("button", { name: "Show earlier messages" });
    await expect(earlier).toBeVisible();
    await earlier.click();
    await expect(turns(page)).toHaveCount(2);
    await expect(turns(page).first()).toContainText(question);
    await expect(earlier).toHaveCount(0);
  });

  test("spaces the page tighter on a phone than on a wide screen", async ({ page }) => {
    const spacing = async () =>
      page.evaluate(() => {
        const main = document.querySelector("main");
        const intro = document.querySelector("main header p");
        const title = document.querySelector("main h1 span:last-child");
        if (main === null || intro === null || title === null) throw new Error("not rendered");
        return {
          padding: getComputedStyle(main).paddingTop,
          intro: getComputedStyle(intro).fontSize,
          title: getComputedStyle(title).fontSize,
        };
      });
    await page.setViewportSize({ width: 360, height: 640 });
    await openAsk(page, stack().url);
    expect(await spacing()).toEqual({ padding: "20px", intro: "16px", title: "24px" });
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await spacing()).toEqual({ padding: "80px", intro: "18px", title: "36px" });
  });
});

const latestButton = (page: Page) => page.getByRole("button", { name: "Jump to latest" });

/** How far the latest question is from its place just below the sticky header, in pixels. */
async function questionOffTop(page: Page) {
  return turns(page)
    .last()
    .locator("[data-chat-question]")
    .evaluate((element) => {
      const header = document.querySelector("body header");
      const place = parseFloat(getComputedStyle(element).scrollMarginTop);
      if (header === null || place <= header.getBoundingClientRect().bottom) {
        throw new Error("the question's place is not below the header");
      }
      return Math.abs(element.getBoundingClientRect().top - place);
    });
}

/** Room between the end of the conversation and the top of the composer; negative when hidden. */
async function roomAboveComposer(page: Page) {
  return page.evaluate(() => {
    const end = [...document.querySelectorAll("[data-chat-answer]")].at(-1);
    const sticky = document.querySelector("form[aria-label='Ask a question']")?.parentElement;
    if (end === undefined || sticky === null || sticky === undefined) throw new Error("no chat");
    return sticky.getBoundingClientRect().top - end.getBoundingClientRect().bottom;
  });
}

/** Records every vertical scroll position the page passes from now on. */
async function recordScrolling(page: Page) {
  await page.evaluate(() => {
    const seen: number[] = [];
    (window as unknown as { scrolled: number[] }).scrolled = seen;
    window.addEventListener("scroll", () => seen.push(window.scrollY), { passive: true });
  });
}

const scrolled = (page: Page) =>
  page.evaluate(() => (window as unknown as { scrolled: number[] }).scrolled);

test.describe("the chat's scrolling", () => {
  const stack = serveChatStack();

  test("a sent question goes below the header and stays there as its answer streams and ends", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 800 });
    await openAsk(page, stack().url);
    await page.getByRole("button", { name: `Would ${name} fit an AI engineering role?` }).click();
    await expect.poll(() => questionOffTop(page)).toBeLessThan(1.5);
    await answered(page);

    for (const text of [question, `How can I contact ${name}?`]) {
      await send(page, text);
      await expect(turns(page).last()).toContainText(text);
      await expect.poll(() => questionOffTop(page)).toBeLessThan(1.5);
      await answered(page);
      // Neither the end of the answer nor its new state moves the page.
      const settled = await page.evaluate(() => window.scrollY);
      await recordScrolling(page);
      await page.waitForTimeout(500);
      expect(await scrolled(page)).toEqual([]);
      expect(await page.evaluate(() => window.scrollY)).toBe(settled);
      expect(await questionOffTop(page)).toBeLessThan(1.5);
      // Latest is offered exactly when the answer runs on below the composer.
      const runsOn = (await roomAboveComposer(page)) < 0;
      await expect(latestButton(page)).toHaveCount(runsOn ? 1 : 0);
    }
  });

  test("moves at once under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 800 });
    await openAsk(page, stack().url);
    await send(page, question);
    await answered(page);
    await recordScrolling(page);
    await send(page, "And what does she work on now?");
    await expect.poll(() => questionOffTop(page)).toBeLessThan(1.5);
    await answered(page);
    // One jump straight to the question, no steps in between.
    const positions = await scrolled(page);
    expect(positions.length).toBeGreaterThan(0);
    expect(new Set(positions).size).toBe(1);
  });

  test("a restored conversation shows its end at once, after a reload and coming back", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await openAsk(page, stack().url);
    for (const text of [
      `Would ${name} fit an AI engineering role?`,
      `What is ${name} working on now?`,
      question,
    ]) {
      await send(page, text);
      await answered(page);
    }

    await page.reload();
    await hydrated(page);
    await expect(turns(page)).toHaveCount(3);
    await expect.poll(() => roomAboveComposer(page)).toBeGreaterThanOrEqual(0);
    await expect(latestButton(page)).toHaveCount(0);
    // Shown once: the reader can scroll up and stays there.
    await recordScrolling(page);
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(300);
    expect(new Set(await scrolled(page))).toEqual(new Set([0]));
    await expect(latestButton(page)).toBeVisible();

    // Away to a cited page and back again.
    await turns(page)
      .last()
      .getByRole("list", { name: "Sources", exact: true })
      .getByRole("link")
      .click();
    await expect(page).toHaveURL(new RegExp(`^${stack().url}/?$`, "u"));
    await page.goBack();
    await expect(page).toHaveURL(askAddress);
    await expect(turns(page)).toHaveCount(3);
    await expect.poll(() => roomAboveComposer(page)).toBeGreaterThanOrEqual(0);
  });

  test("with a phone's keyboard open, a sent question still reaches the top above the composer", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await openAsk(page, stack().url);
    await send(page, question);
    await answered(page);
    // An open on-screen keyboard leaves this much of the screen.
    await page.setViewportSize({ width: 360, height: 320 });
    await send(page, "And what does she work on now?");
    await expect.poll(() => questionOffTop(page)).toBeLessThan(1.5);
    await expect(composer(page)).toBeInViewport();
    await answered(page);
    expect(await questionOffTop(page)).toBeLessThan(1.5);
    await expect(composer(page)).toBeInViewport();
    await expectNoHorizontalScroll(page);
  });
});

test.describe("a reader who scrolls away while an answer is prepared", () => {
  // The fictional model waits for the gate before it answers.
  const stack = serveChatStack({ scenario: "slow" });

  test("is never pulled back, and Latest brings back the end", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await openAsk(page, stack().url);
    // Two answered turns first, so there is a conversation to scroll back through.
    await stack().openGate();
    for (const earlier of [question, "And what does she work on now?"]) {
      await send(page, earlier);
      await answered(page);
    }
    await stack().closeGate();
    await send(page, "A third fictional question?");
    await expect(turns(page).last()).toContainText("Answering…");
    await expect.poll(() => questionOffTop(page)).toBeLessThan(1.5);
    await expect(latestButton(page)).toHaveCount(0);

    await page.mouse.move(180, 300);
    await page.mouse.wheel(0, -2000);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(latestButton(page)).toBeVisible();
    const box = await latestButton(page).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await recordScrolling(page);
    await stack().openGate();
    await answered(page);
    await expect(turns(page).last()).toContainText(answerText);
    await page.waitForTimeout(300);
    expect(await scrolled(page)).toEqual([]);

    // By keyboard: the end comes into view, the button goes and the keyboard is at the answer.
    await latestButton(page).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => roomAboveComposer(page)).toBeGreaterThanOrEqual(0);
    await expect(latestButton(page)).toHaveCount(0);
    await expect(turns(page).last().locator("[data-chat-answer]")).toBeFocused();

    // And with a pointer.
    await page.mouse.wheel(0, -2000);
    await expect(latestButton(page)).toBeVisible();
    await latestButton(page).click();
    await expect.poll(() => roomAboveComposer(page)).toBeGreaterThanOrEqual(0);
    await expect(latestButton(page)).toHaveCount(0);
  });
});

const cards = (page: Page) => turns(page).last().getByRole("list", { name: "Cards" });
const sources = (page: Page) =>
  turns(page).last().getByRole("list", { name: "Sources", exact: true });

test.describe("the answers' cards and sources", () => {
  const stack = serveChatStack();

  test("an answer about contact shows the contact card and cites the profile", async ({ page }) => {
    await openAsk(page, stack().url);
    await send(page, `How can I contact ${name}?`);
    await answered(page);
    const card = cards(page).locator(":scope > li");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("Contact");
    await expect(card.getByRole("link", { name: "ilsa@marrow.example.test" })).toHaveAttribute(
      "href",
      "mailto:ilsa@marrow.example.test",
    );
    await expect(card.getByRole("link", { name: "Website" })).toHaveAttribute(
      "href",
      "https://marrow.example.test/",
    );
    await expect(sources(page).getByRole("link")).toHaveText([name]);
    await sources(page).getByRole("link", { name }).click();
    await expect(page).toHaveURL(new RegExp(`^${stack().url}/?$`, "u"));
  });

  test("reaches the cards and the sources with the keyboard", async ({ page }) => {
    await openAsk(page, stack().url);
    await send(page, `How can I contact ${name}?`);
    await answered(page);
    const links = [cards(page).getByRole("link"), sources(page).getByRole("link")];
    const expected: (string | null)[] = [];
    for (const group of links) {
      expected.push(
        ...(await group.evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("href")),
        )),
      );
    }
    await links[0]?.first().focus();
    const reached: (string | null)[] = [];
    while (reached.length < expected.length) {
      reached.push(await page.evaluate(() => document.activeElement?.getAttribute("href") ?? null));
      await page.keyboard.press("Tab");
    }
    expect(reached).toEqual(expected);
    // Enter on a focused source follows it.
    await sources(page).getByRole("link").first().focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`^${stack().url}/?$`, "u"));
  });
});

test.describe("the chat's layout", () => {
  const stack = serveChatStack();

  for (const scheme of schemes) {
    for (const width of widths) {
      test(`fits ${String(width)} px in ${scheme} mode without violations`, async ({
        page,
      }, testInfo) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height: 900 });

        await page.goto(stack().url);
        await hydrated(page);
        await expectLoaded(page);
        await expectNoHorizontalScroll(page);
        await page.getByTestId("hero-chat-entry").screenshot({
          path: testInfo.outputPath(`hero-chat-${String(width)}-${scheme}.png`),
        });

        await openAsk(page, stack().url);
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
        // Scrolled to its end, the page shows the profile note below the composer.
        await page.evaluate(() => {
          window.scrollTo(0, document.documentElement.scrollHeight);
        });
        await page.screenshot({
          path: testInfo.outputPath(`ask-end-${String(width)}-${scheme}.png`),
        });

        // An answer with a card and its sources.
        await send(page, `How can I contact ${name}?`);
        await answered(page);
        await expect(turns(page)).toHaveCount(2);
        await page.mouse.move(0, 0);
        await expectNoHorizontalScroll(page);
        await expectAccessible(page);
        const answerHeights = await conversation(page)
          .locator("a")
          .evaluateAll((elements) =>
            elements
              .filter((element) => element.checkVisibility())
              .map((element) => element.getBoundingClientRect().height),
          );
        for (const height of answerHeights) expect(height).toBeGreaterThanOrEqual(44);
        // A viewport tall enough for the whole conversation, so the sticky header and composer
        // stay in their places instead of covering the answers in the pictures.
        await page.setViewportSize({ width, height: 3000 });
        for (const [index, answer] of ["role", "contact"].entries()) {
          await turns(page)
            .nth(index)
            .screenshot({
              path: testInfo.outputPath(`answer-${answer}-${String(width)}-${scheme}.png`),
            });
        }
      });
    }
  }
});

test.describe("visitors behind the trusted proxy", () => {
  const stack = serveChatStack();

  /**
   * Asks `times` questions through the website's relay as a visitor whom the proxy saw at
   * `address`, behind a spoofed left `X-Forwarded-For` entry; a new visitor every five questions,
   * below the per-visitor allowance. Waits for each admitted answer to end; returns the statuses.
   */
  async function askFrom(address: string, times: number): Promise<number[]> {
    const statuses: number[] = [];
    const url = stack().url;
    const headers = { origin: url, "x-forwarded-for": `203.0.113.250, ${address}` };
    let visitor = await requests.newContext({ baseURL: url, extraHTTPHeaders: headers });
    try {
      for (let index = 0; index < times; index += 1) {
        if (index > 0 && index % 5 === 0) {
          await visitor.dispose();
          visitor = await requests.newContext({ baseURL: url, extraHTTPHeaders: headers });
        }
        if (index % 5 === 0)
          expect((await visitor.get("/api/chat/conversation")).status()).toBe(200);
        const asked = await visitor.post("/api/chat/conversation/messages", {
          data: {
            requestId: randomUUID(),
            question: `${question} (${String(index)})`,
            challengeToken: `pass-${randomUUID()}`,
          },
        });
        statuses.push(asked.status());
        if (asked.status() !== 202) continue;
        const { operationId } = (await asked.json()) as { operationId: string };
        await expect
          .poll(
            async () => {
              const read = await visitor.get(`/api/chat/operations/${operationId}`);
              return ((await read.json()) as { status: string }).status;
            },
            { timeout: 30_000 },
          )
          .toMatch(/^(completed|failed|interrupted)$/u);
      }
    } finally {
      await visitor.dispose();
    }
    return statuses;
  }

  test("two visitor addresses are counted apart and a spoofed entry is never believed", async () => {
    test.setTimeout(180_000);
    const first = "198.51.100.31";
    const second = "198.51.100.32";

    expect(await askFrom(first, 20)).toEqual(Array<number>(20).fill(202));
    expect(await askFrom(first, 1)).toEqual([429]);
    expect(await askFrom(second, 1)).toEqual([202]);

    // Every challenge is redeemed before the quota is counted, the refused question's too.
    const sent = stack().remoteAddresses();
    expect(sent).toHaveLength(20 + 1 + 1);
    expect(new Set(sent)).toEqual(new Set([first, second]));
  });
});
