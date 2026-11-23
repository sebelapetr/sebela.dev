import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import type { ChatUsage } from "@sebela/contracts";

import { serveChatStack } from "./chat-stack";

// The composer's usage panel: the visitor's own meters as the API counts them, over the real chat
// path (e2e/chat-stack.ts), and every state the panel can be in, from snapshots this file gives the
// page in place of the API's (`page.route`). Reading the usage never asks the model anything.

const question = "What does Ilsa Marrow build?";

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
const usagePanel = (page: Page) => page.getByRole("region", { name: "Your usage" });
const usageToggle = (page: Page) => usagePanel(page).getByRole("button", { name: /^Usage/ });

async function openAsk(page: Page, url: string) {
  await page.goto(`${url}/ask`);
  await hydrated(page);
  await expect(page.getByText("Loading your conversation…")).toHaveCount(0);
}

async function answered(page: Page) {
  await expect(turns(page).last().locator("[aria-busy='false']")).toHaveCount(1);
}

/** Opens the panel. */
async function openUsage(page: Page) {
  await usageToggle(page).click();
  await expect(usageToggle(page)).toHaveAttribute("aria-expanded", "true");
}

test.describe("the visitor's usage over the real chat path", () => {
  const stack = serveChatStack({ scenario: "answer" });

  test("counts a question once, agrees across tabs and reading it consumes nothing", async ({
    page,
    context,
  }) => {
    await openAsk(page, stack().url);
    await expect(usageToggle(page)).toHaveAccessibleName(
      "Usage: Last 2 hours, 0 of 10 questions; Today (UTC), 0 of 30 questions",
    );
    await openUsage(page);
    const panel = usagePanel(page);
    await expect(panel.getByText("0 of 10 questions", { exact: true })).toBeVisible();
    await expect(panel.getByText("0 of 30 questions", { exact: true })).toBeVisible();
    await expect(panel.getByText("Unavailable", { exact: true }).first()).toBeVisible();
    await expect(panel.getByText(/^Model$/)).toBeVisible();

    await composer(page).fill(question);
    await composer(page).press("Enter");
    await answered(page);
    await expect(panel.getByText("1 of 10 questions", { exact: true })).toBeVisible();
    await expect(panel.getByText("1 of 30 questions", { exact: true })).toBeVisible();
    await expect(panel.getByText(/of 16,000 input tokens$/)).toBeVisible();
    const calls = (await stack().calls()).length;
    const redeemed = stack().redeemed().length;

    // A reload and a second tab read the same counts from the API; neither asks anything.
    await page.reload();
    await hydrated(page);
    await expect(usageToggle(page)).toContainText("2 h 1/10 · today 1/30");
    const second = await context.newPage();
    await openAsk(second, stack().url);
    await expect(usageToggle(second)).toContainText("2 h 1/10 · today 1/30");
    await openUsage(second);
    await expect(usagePanel(second).getByText("1 of 10 questions", { exact: true })).toBeVisible();
    expect((await stack().calls()).length).toBe(calls);
    expect(stack().redeemed()).toHaveLength(redeemed);
  });
});

/** A snapshot whose times are counted from now, so the panel's relative times read naturally. */
function snapshot(fields: {
  twoHours: number;
  day: number;
  restriction?: ChatUsage["restriction"];
  context?: ChatUsage["context"];
  active?: boolean;
}): ChatUsage {
  const now = Date.now();
  const minute = 60_000;
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return {
    serverTime: new Date(now).toISOString(),
    model: { name: "fictional-model", effort: "medium" },
    rollingTwoHours: {
      used: fields.twoHours,
      limit: 10,
      percent: fields.twoHours * 10,
      nextReleaseAt: fields.twoHours === 0 ? null : new Date(now + 25 * minute).toISOString(),
    },
    utcDay: {
      used: fields.day,
      limit: 30,
      percent: (fields.day * 100) / 30,
      resetsAt: midnight.toISOString(),
    },
    activeOperation:
      fields.active === true
        ? {
            operationId: "00000000-0000-4000-8000-000000000001",
            requestId: "00000000-0000-4000-8000-000000000002",
            status: "running",
            deadlineAt: new Date(now + 2 * minute).toISOString(),
            assistantMessageId: "00000000-0000-4000-8000-000000000003",
            kind: "answer",
            compaction: null,
          }
        : null,
    restriction: fields.restriction ?? null,
    context: fields.context ?? { status: "unavailable" },
    nextRequest: { status: "unavailable" },
  };
}

function measured(estimated: number, reported: number | null): ChatUsage["context"] {
  return {
    status: "measured",
    operationId: "00000000-0000-4000-8000-000000000004",
    measuredAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    estimatedInputTokens: estimated,
    reportedInputTokens: reported,
    capTokens: 16_000,
  };
}

interface UsageCase {
  readonly name: string;
  /** The snapshot the page reads; null answers 500, as an API that cannot read the usage. */
  readonly usage: () => ChatUsage | null;
  /** What the collapsed line says beside the counts. */
  readonly note: string | null;
  /** What the open panel shows, in words. */
  readonly shows: readonly string[];
}

const cases: readonly UsageCase[] = [
  {
    name: "neutral",
    usage: () => snapshot({ twoHours: 2, day: 5, context: measured(6_210, 6_288) }),
    note: null,
    shows: ["2 of 10 questions", "5 of 30 questions", "6,288 of 16,000 input tokens"],
  },
  {
    name: "warning",
    usage: () => snapshot({ twoHours: 8, day: 22, context: measured(12_345, null) }),
    note: "Over 70% used",
    shows: ["8 of 10 questions", "Over 70% used", "About 12,345 of 16,000 input tokens"],
  },
  {
    name: "critical",
    usage: () => snapshot({ twoHours: 6, day: 28, context: measured(15_500, 15_620) }),
    note: "Over 90% used",
    shows: ["28 of 30 questions", "Over 90% used", "15,620 of 16,000 input tokens"],
  },
  {
    name: "full",
    usage: () =>
      snapshot({
        twoHours: 10,
        day: 12,
        restriction: {
          reason: "two_hours",
          retryAt: new Date(Date.now() + 25 * 60_000).toISOString(),
        },
        context: measured(9_800, 9_912),
      }),
    note: "Limit reached",
    shows: ["10 of 10 questions", "Limit reached"],
  },
  {
    name: "unavailable",
    usage: () => null,
    note: "Unavailable",
    shows: ["Your usage could not be read right now."],
  },
  {
    name: "active",
    usage: () => snapshot({ twoHours: 3, day: 3, active: true }),
    note: null,
    shows: ["An answer is being prepared. Its question already counts.", "3 of 10 questions"],
  },
];

test.describe("the usage panel's states", () => {
  const stack = serveChatStack({ scenario: "answer" });

  for (const item of cases) {
    test(`${item.name}: says its state in words and keeps the composer free`, async ({ page }) => {
      await page.route("**/api/chat/usage", (route) => {
        const usage = item.usage();
        return usage === null
          ? route.fulfill({ status: 500, json: { error: { code: "internal_error" } } })
          : route.fulfill({ json: usage });
      });
      await openAsk(page, stack().url);
      if (item.note !== null) await expect(usageToggle(page)).toContainText(item.note);
      await openUsage(page);
      for (const text of item.shows) {
        await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
      }
      // The composer stays usable whatever the usage says; the API decides on admission.
      await expect(composer(page)).toBeEditable();
    });
  }

  test("a limit that is not the visitor's own says so, with when to ask again and Contact", async ({
    page,
  }) => {
    await page.route("**/api/chat/usage", (route) =>
      route.fulfill({
        json: snapshot({
          twoHours: 1,
          day: 1,
          restriction: {
            reason: "shared_network",
            retryAt: new Date(Date.now() + 90 * 60_000).toISOString(),
          },
        }),
      }),
    );
    await openAsk(page, stack().url);
    const status = page.getByRole("status").filter({ hasText: "Many questions came from" });
    await expect(status).toContainText("This is not your own usage.");
    await expect(status).toContainText("You can ask again at");
    await expect(status.getByRole("link", { name: "Contact" })).toBeVisible();
    await expect(usageToggle(page)).toContainText("Paused");
  });

  test("keeps the last numbers, marked out of date, when a later read fails", async ({ page }) => {
    let fail = false;
    await page.route("**/api/chat/usage", (route) =>
      fail
        ? route.fulfill({ status: 503, json: { error: { code: "unavailable" } } })
        : route.fulfill({ json: snapshot({ twoHours: 4, day: 4 }) }),
    );
    await openAsk(page, stack().url);
    await expect(usageToggle(page)).toContainText("2 h 4/10");
    fail = true;
    await openUsage(page);
    await expect(usageToggle(page)).toContainText("Not up to date");
    await expect(usagePanel(page).getByText(/^Not up to date\. Last read at/)).toBeVisible();
    await expect(usagePanel(page).getByText("4 of 10 questions", { exact: true })).toBeVisible();
  });
});

test.describe("the usage panel's layout", () => {
  const stack = serveChatStack({ scenario: "answer" });

  for (const scheme of schemes) {
    for (const width of widths) {
      test(`fits ${String(width)} px in ${scheme} mode without violations`, async ({
        page,
      }, testInfo) => {
        test.setTimeout(90_000);
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.setViewportSize({ width, height: width === 360 ? 740 : 900 });
        let current: UsageCase | undefined;
        await page.route("**/api/chat/usage", (route) => {
          const usage = current?.usage() ?? null;
          return usage === null
            ? route.fulfill({ status: 500, json: { error: { code: "internal_error" } } })
            : route.fulfill({ json: usage });
        });
        for (const item of cases) {
          current = item;
          await openAsk(page, stack().url);
          await openUsage(page);
          await expect(page.getByText(item.shows[0] ?? "", { exact: false }).first()).toBeVisible();
          await expectNoHorizontalScroll(page);
          await expectAccessible(page);
          const toggle = await usageToggle(page).boundingBox();
          const input = await composer(page).boundingBox();
          if (toggle === null || input === null) throw new Error("composer not laid out");
          expect(toggle.height).toBeGreaterThanOrEqual(44);
          // The open panel never covers the input: the input stays inside the screen below it.
          expect(input.y + input.height).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
          expect(toggle.y + toggle.height).toBeLessThanOrEqual(input.y);
          await page.mouse.move(0, 0);
          await page.screenshot({
            path: testInfo.outputPath(`usage-${item.name}-${String(width)}-${scheme}.png`),
          });
        }
        // Keyboard: the toggle is reached and works from the keyboard.
        current = cases[0];
        await openAsk(page, stack().url);
        await usageToggle(page).focus();
        await page.keyboard.press("Enter");
        await expect(usageToggle(page)).toHaveAttribute("aria-expanded", "true");
        await page.keyboard.press("Enter");
        await expect(usageToggle(page)).toHaveAttribute("aria-expanded", "false");
        await page.screenshot({
          path: testInfo.outputPath(`usage-collapsed-${String(width)}-${scheme}.png`),
        });
      });
    }
  }
});
