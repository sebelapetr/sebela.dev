// The learning statistics against the fictional time of e2e/fixtures/with-statistics/ (Robin
// Ashby): resource time in two areas, a book's resource, an evening at a meetup, a session across
// Prague midnight, a quiet week between two busy ones, a resource and an event without any time and
// a resource name that tries to inject markup. The browser runs in a time zone far from Prague, so
// every day shown must be Prague's whatever the browser's zone. It covers the reconciliation of the
// API's aggregates, the diary's day totals and the rendered page against independently worked
// figures, the diary-to-day-to-statistics navigation, the evidence links, safe rendering, the
// keyboard, widths, themes, axe and touch targets, a time write reaching the warmed statistics
// through the signed invalidation, no time on the main stack and the unavailable state.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freePort, origin, required, startApi, startWebsite, type Started } from "./stack";

const scratch = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
const within = { timeout: 10_000, intervals: [250] };

const name = "Robin Ashby";
const unavailable = "This page could not be loaded right now.";
const widths = [360, 768, 1280] as const;
const schemes = ["light", "dark"] as const;

const diary = "/ai-roadmap/diary";
const statistics = `${diary}/stats`;
const busyDay = `${diary}/2026-03-02`;
const queueName =
  "Queue notes <b>not bold</b> with averyveryverylongfictionalqueueidentifierthatmustbreak";

// Worked out by hand from the fixture's six entries, in seconds:
// Feb 20 1h resource; Mar 2 1h 30m resource + 1h book; Mar 3 2h event; Mar 4 23:30 – Mar 5 00:30
// resource, 30 min on each day; Mar 9 45 min book.
const hour = 3600;
const minute = 60;
const expectedTotals = {
  totalSeconds: 7 * hour + 15 * minute,
  resourceSeconds: 3 * hour + 30 * minute,
  bookSeconds: hour + 45 * minute,
  eventSeconds: 2 * hour,
  activeDays: 6,
};
const expectedDays = [
  ["2026-02-20", hour],
  ["2026-03-02", 2 * hour + 30 * minute],
  ["2026-03-03", 2 * hour],
  ["2026-03-04", 30 * minute],
  ["2026-03-05", 30 * minute],
  ["2026-03-09", 45 * minute],
] as const;

// Far from Prague on both sides of the date line: a day taken from the browser's zone would differ.
test.use({ timezoneId: "Pacific/Kiritimati" });

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

// Every visible link of the sub-navigation and the content is at least 44 px tall
// (docs/design.md, Components); this page has no link inside running text.
async function expectTouchTargets(page: Page) {
  const heights = await page
    .locator('nav[aria-label="AI Roadmap"] a, main a, main button')
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.checkVisibility())
        .map((element) => ({
          target: element.outerHTML.slice(0, 160),
          height: element.getBoundingClientRect().height,
        })),
    );
  expect(heights.length).toBeGreaterThan(0);
  for (const { target, height } of heights) expect(height, target).toBeGreaterThanOrEqual(44);
}

// The page's robots tag; roadmap pages are indexed, so it is absent.
function robots(page: Page) {
  return page.locator('meta[name="robots"]');
}

interface Split {
  readonly totalSeconds: number;
  readonly resourceSeconds: number;
  readonly bookSeconds: number;
  readonly eventSeconds: number;
}

interface StatisticsBody {
  readonly totals: Split & { readonly activeDays: number };
  readonly days: readonly (Split & { readonly date: string })[];
  readonly weeks: readonly (Split & { readonly startsOn: string })[];
  readonly months: readonly (Split & { readonly month: string })[];
}

interface DiaryBody {
  readonly days: readonly { readonly date: string; readonly totalSeconds: number }[];
}

test.describe.configure({ mode: "serial" });

test.describe("the learning statistics", () => {
  let api: Started;
  let website: Started;
  let key: string;
  let keyFile: string;

  test.beforeAll(async () => {
    // A disposable secret and key for this run only.
    const secret = randomBytes(32).toString("hex");
    await mkdir(scratch, { recursive: true });
    keyFile = `${scratch}e2e-api-key-${randomBytes(6).toString("hex")}`;
    const webPort = await freePort(required("WEB_HOST"));
    api = await startApi("with-statistics", {
      invalidation: {
        url: `${origin(required("WEB_HOST"), webPort)}/internal/invalidation`,
        secret,
      },
      keyFile,
    });
    key = (await readFile(keyFile, "utf8")).trim();
    website = await startWebsite(api.url, { port: webPort, invalidationSecret: secret });
  });

  test.afterAll(async () => {
    await website.stop();
    await api.stop();
    await rm(keyFile, { force: true });
  });

  async function read<T>(path: string): Promise<T> {
    const response = await fetch(`${api.url}${path}`);
    expect(response.status, path).toBe(200);
    return (await response.json()) as T;
  }

  async function write(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown) {
    const response = await fetch(`${api.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.ok, `${method} ${path} answers ${String(response.status)}`).toBe(true);
    return response.status === 204 ? null : (response.json() as Promise<unknown>);
  }

  // The page's HTML without React's text separators (`<!-- -->`), so adjacent text reads as shown.
  async function text(path: string): Promise<string> {
    const response = await fetch(`${website.url}${path}`);
    return (await response.text()).replaceAll("<!-- -->", "");
  }

  // The page's text without its tags, so a label and the value beside it read as one string.
  async function shown(path: string): Promise<string> {
    return (await text(path)).replaceAll(/<[^>]*>/gu, "");
  }

  test("the API's aggregates, the diary's day totals and the page reconcile", async ({ page }) => {
    const body = await read<StatisticsBody>("/v1/roadmap/statistics");
    expect(body.totals).toEqual(expectedTotals);
    // Every period's three kinds add up to its total, and the periods add up to the overall total.
    for (const period of [...body.days, ...body.weeks, ...body.months]) {
      expect(period.resourceSeconds + period.bookSeconds + period.eventSeconds).toBe(
        period.totalSeconds,
      );
    }
    for (const periods of [body.days, body.weeks, body.months]) {
      expect(periods.reduce((sum, period) => sum + period.totalSeconds, 0)).toBe(
        expectedTotals.totalSeconds,
      );
    }
    expect(body.days.map((day) => [day.date, day.totalSeconds])).toEqual(expectedDays);
    // The quiet week between two busy ones is present with nothing in it.
    expect(body.weeks.map((week) => [week.startsOn, week.totalSeconds])).toEqual([
      ["2026-02-16", hour],
      ["2026-02-23", 0],
      ["2026-03-02", 5 * hour + 30 * minute],
      ["2026-03-09", 45 * minute],
    ]);

    // The diary's own day totals are the same.
    const diaryBody = await read<DiaryBody>("/v1/roadmap/diary");
    const diaryTotals = new Map(diaryBody.days.map((day) => [day.date, day.totalSeconds]));
    for (const [date, seconds] of expectedDays) expect(diaryTotals.get(date), date).toBe(seconds);

    // The rendered diary and the rendered statistics show the same total for every day.
    await page.goto(`${website.url}${diary}`);
    const diaryRows = page.getByRole("list", { name: "Diary days" }).locator(":scope > li");
    // A day covered only by an event without attendance (March 6) shows no time.
    const shownInDiary = new Map(
      await diaryRows.evaluateAll((rows) =>
        rows.flatMap((row) => {
          const date = row.querySelector("h2 time")?.getAttribute("datetime");
          const figures = row.querySelector("p.type-label")?.textContent;
          if (!date || !figures) return [];
          return [[date, figures.split(" · ")[0] ?? ""] as [string, string]];
        }),
      ),
    );
    expect([...shownInDiary.keys()].sort()).toEqual(expectedDays.map(([date]) => date));

    await page.goto(`${website.url}${statistics}`);
    const days = page.getByRole("list", { name: "Recent activity" }).locator(":scope > li");
    await expect(days.locator("time")).toHaveText([
      "Monday, March 9, 2026",
      "Thursday, March 5, 2026",
      "Wednesday, March 4, 2026",
      "Tuesday, March 3, 2026",
      "Monday, March 2, 2026",
      "Friday, February 20, 2026",
    ]);
    for (const row of await days.all()) {
      const date = (await row.locator("time").getAttribute("datetime")) ?? "";
      await expect(row.locator("p.type-label"), date).toHaveText(shownInDiary.get(date) ?? "");
    }
    await expect(days.nth(4)).toContainText("1h 30m resources · 1h books");
    await expect(days.nth(3)).toContainText("2h events");

    // The figures and kinds, rounded only for display.
    const figures = page.locator("main dl").first();
    await expect(figures.locator("dt")).toHaveText([
      "Total time",
      "Days with time",
      "Avg per day with time",
    ]);
    await expect(figures.locator("dd")).toHaveText(["7h 15m", "6", "1h 13m"]);
    const kinds = page.locator("main dl").nth(1);
    await expect(kinds.locator("dd")).toHaveText([
      "3h 30m · 48.3%",
      "1h 45m · 24.1%",
      "2h · 27.6%",
    ]);
  });

  test("the areas and modules show study time only; events stand apart", async ({ page }) => {
    const response = await page.goto(`${website.url}${statistics}`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(
      `Learning Statistics — Learning Diary — AI Engineering Roadmap — ${name}`,
    );
    await expect(robots(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Learning Statistics");
    await expect(
      page.getByRole("navigation", { name: "AI Roadmap" }).locator('[aria-current="page"]'),
    ).toHaveText("Learning Diary");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Totals",
      "Time by area",
      "Recent activity",
      "By week",
      "By month",
      "Resources",
      "Events",
    ]);
    await expect(page.locator("main")).toContainText(
      "Shares of the 5h 15m studied on resources and books. Time at events belongs to no area.",
    );

    const areas = page.getByRole("list", { name: "Areas" }).locator(":scope > li");
    await expect(areas.locator("h3")).toHaveText(["Orbit foundations", "Queue craft"]);
    await expect(areas.first()).toContainText("4h 15m · 81.0%");
    await expect(
      page.getByRole("list", { name: "Modules of Orbit foundations" }).getByRole("listitem"),
    ).toHaveText([/Signal basics\s*2h 30m · 47\.6%/u, /Signal tuning\s*1h 45m · 33\.3%/u]);
    await expect(areas.nth(1)).toContainText("1h · 19.0%");
    // No area or module includes the meetup's two hours.
    await expect(page.getByRole("list", { name: "Areas" })).not.toContainText("Spring orbit");

    const weeks = page.getByRole("list", { name: "By week" }).getByRole("listitem");
    await expect(weeks).toHaveText([
      /Week of March 9, 2026\s*45 min/u,
      /Week of March 2, 2026\s*5h 30m/u,
      /Week of February 23, 2026\s*0 min/u,
      /Week of February 16, 2026\s*1h/u,
    ]);
    await expect(page.getByRole("list", { name: "By month" }).getByRole("listitem")).toHaveText([
      /March 2026\s*6h 15m/u,
      /February 2026\s*1h/u,
    ]);

    const events = page.getByRole("list", { name: "Events with logged time" });
    await expect(events.getByRole("listitem")).toHaveCount(1);
    await expect(events).toContainText("Spring orbit meetup");
    await expect(events).toContainText("Meetup");
    await expect(events).toContainText("March 3, 2026");
    await expect(page.locator("main")).not.toContainText("An unattended lecture");
    await expect(page.locator("main")).not.toContainText("Tuning notes nobody opened");
  });

  test("every resource, book and event leads to its evidence", async ({ page }) => {
    await page.goto(`${website.url}${statistics}`);
    const resources = page.getByRole("list", { name: "Resources with logged time" });
    await expect(resources.locator("h3")).toHaveText([
      "A fictional signal explainer",
      "Reading the quiet orbit handbook",
      queueName,
    ]);
    await expect(
      resources.getByRole("link", { name: "A fictional signal explainer", exact: true }),
    ).toHaveAttribute(
      "href",
      "/ai-roadmap/orbit-foundations/signal-basics#resource-signal-explainer",
    );
    await expect(resources.getByRole("listitem").nth(1)).toContainText(
      "Book · Signal tuning · Orbit foundations",
    );
    await expect(
      page.getByRole("link", { name: "On the bookshelf: Reading the quiet orbit handbook" }),
    ).toHaveAttribute("href", "/ai-roadmap/bookshelf/quiet-orbit-handbook");
    await expect(
      page.getByRole("link", { name: "In the learning diary: Spring orbit meetup" }),
    ).toHaveAttribute("href", `${diary}/2026-03-03`);
    await expect(page.getByRole("link", { name: "Monday, March 2, 2026" })).toHaveAttribute(
      "href",
      busyDay,
    );
    await expect(page.getByRole("link", { name: "Orbit foundations" })).toHaveAttribute(
      "href",
      "/ai-roadmap/orbit-foundations",
    );

    // A resource's link lands on it on its module's page.
    await resources
      .getByRole("link", { name: "A fictional signal explainer", exact: true })
      .click();
    await expect(page).toHaveURL(
      /\/ai-roadmap\/orbit-foundations\/signal-basics#resource-signal-explainer$/u,
    );
    await expect(page.locator("#resource-signal-explainer")).toBeInViewport();
  });

  test("renders names as text and long words break instead of widening the page", async ({
    page,
  }) => {
    await page.goto(`${website.url}${statistics}`);
    await expect(page.locator("main")).toContainText("<b>not bold</b>");
    await expect(page.locator("main b")).toHaveCount(0);
    await page.setViewportSize({ width: 360, height: 800 });
    await expectNoHorizontalScroll(page);
  });

  test("the keyboard goes from the diary to a day, on to the statistics and back to the day", async ({
    page,
  }) => {
    await page.goto(`${website.url}${diary}`);
    const toStatistics = page.getByRole("link", { name: "View statistics" });
    await expect(toStatistics).toHaveAttribute("href", statistics);
    // A chart icon before the text and an arrow after it, both hidden from assistive technology.
    await expect(toStatistics).toHaveAccessibleName("View statistics");
    await expect(toStatistics.locator("svg")).toHaveCount(2);
    await expect(toStatistics.locator("svg:not([aria-hidden='true'])")).toHaveCount(0);
    const day = page.getByRole("link", { name: "Monday, March 2, 2026" });
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press("Tab");
      if (await day.evaluate((element) => element === document.activeElement)) break;
    }
    await expect(day).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${website.url}${busyDay}`);

    const onward = page.getByRole("link", { name: "View statistics" });
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press("Tab");
      if (await onward.evaluate((element) => element === document.activeElement)) break;
    }
    await expect(onward).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${website.url}${statistics}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Learning Statistics");

    const back = page.getByRole("link", { name: "Monday, March 2, 2026" });
    for (let step = 0; step < 60; step += 1) {
      await page.keyboard.press("Tab");
      if (await back.evaluate((element) => element === document.activeElement)) break;
    }
    await expect(back).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${website.url}${busyDay}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Monday, March 2, 2026");
  });

  test("fits every width and mode, accessible and with large targets", async ({ page }) => {
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [label, path] of [
        ["page", statistics],
        ["diary", diary],
        ["day", busyDay],
      ] as const) {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(`${website.url}${path}`);
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          await expectNoHorizontalScroll(page);
          await expectTouchTargets(page);
          await page.screenshot({
            path: test.info().outputPath(`statistics-${label}-${String(width)}-${scheme}.png`),
            fullPage: true,
          });
          if (width === 360 || width === 1280) await expectAccessible(page);
        }
      }
    }
  });

  test("a time write reaches the warmed statistics and its removal takes it back", async () => {
    // Warm the page the write will change.
    expect(await text(statistics)).toContain("7h 15m");

    const created = (await write("POST", "/v1/roadmap/time-entries", {
      event: "unattended-lecture",
      startedAt: "2026-03-06T17:00:00+01:00",
      endedAt: "2026-03-06T17:45:00+01:00",
    })) as { entries: { id: string }[] };
    const id = created.entries[0]?.id ?? "";
    await expect.poll(() => text(statistics), within).toContain("8h");
    const after = await text(statistics);
    expect(after).toContain("An unattended lecture");
    expect(after).toContain("Friday, March 6, 2026");

    await write("DELETE", `/v1/roadmap/time-entries/${id}`);
    await expect.poll(() => text(statistics), within).not.toContain("An unattended lecture");
    expect(await text(statistics)).toContain("7h 15m");
  });

  test("a resource moved to another area and made a book moves its logged time on the warmed page", async () => {
    // Warm the page: the explainer's 2h 30m is resource time in Signal basics (Orbit foundations).
    const before = await shown(statistics);
    expect(before).toContain("Resources3h 30m · 48.3%");
    expect(before).toContain("Orbit foundations");
    expect(before).toContain("4h 15m · 81.0%");
    expect(before).toContain("2h 30m · 47.6%");
    expect(before).toContain("Resource · Signal basics · Orbit foundations");

    await write("PATCH", "/v1/roadmap/resources/signal-explainer", {
      module: "calm-queues",
      type: "book",
    });
    // Study time stays 5h 15m: Orbit foundations keeps the handbook's 1h 45m (33.3%), Queue craft
    // gains the explainer (1h + 2h 30m = 3h 30m, 66.7%), and Signal basics has no time left. Of the
    // 7h 15m total, resources keep 1h (13.8%), books gain it (1h 45m + 2h 30m = 4h 15m, 58.6%) and
    // events keep 2h (27.6%); the total does not change.
    await expect
      .poll(() => shown(statistics), within)
      .toContain("Book · Calm queues · Queue craft");
    const moved = await shown(statistics);
    expect(moved).toContain("7h 15m");
    expect(moved).toContain("Resources1h · 13.8%");
    expect(moved).toContain("Books4h 15m · 58.6%");
    expect(moved).toContain("Events2h · 27.6%");
    expect(moved).toContain("1h 45m · 33.3%");
    expect(moved).toContain("3h 30m · 66.7%");
    expect(moved).not.toContain("4h 15m · 81.0%");
    expect(moved).not.toContain("2h 30m · 47.6%");
    expect(moved).not.toContain("Signal basics");

    // Moving it back restores every breakdown without losing or doubling time.
    await write("PATCH", "/v1/roadmap/resources/signal-explainer", {
      module: "signal-basics",
      type: "youtube-video",
    });
    await expect
      .poll(() => shown(statistics), within)
      .toContain("Resource · Signal basics · Orbit foundations");
    const back = await shown(statistics);
    expect(back).toContain("Resources3h 30m · 48.3%");
    expect(back).toContain("4h 15m · 81.0%");
    expect(back).toContain("2h 30m · 47.6%");
    expect(back).toContain("1h · 19.0%");
  });
});

test.describe("no logged time", () => {
  // The main stack's fixture (with-photo) has a profile and no time.
  test("says no time is logged yet", async ({ page }) => {
    const response = await page.goto(statistics);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Learning Statistics");
    await expect(page.locator("main")).toContainText("No time logged yet.");
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
    await expectAccessible(page);
  });
});

test.describe("an unreachable API", () => {
  let website: Started;

  test.beforeAll(async () => {
    // Nothing listens on this port: every read fails.
    const silent = origin(required("API_HOST"), await freePort(required("API_HOST")));
    website = await startWebsite(silent);
  });

  test.afterAll(async () => {
    await website.stop();
  });

  test("the statistics show the unavailable state, never zero activity", async ({ page }) => {
    const response = await page.goto(`${website.url}${statistics}`);
    expect(response?.status()).toBe(500);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(unavailable);
    await expect(page.locator("main")).not.toContainText("No time logged yet.");
    await expect(page.locator("main")).not.toContainText("0 min");
    await expectAccessible(page);
  });
});
