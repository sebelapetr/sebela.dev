// The roadmap's events against the fictional events of e2e/fixtures/with-events/ (Robin Ashby): a
// single-day online lecture, a four-day summit across the turn of the year with time logged on two
// of its days, a workshop whose takeaways try to inject markup and a bare meetup two years back.
// The browser runs in a time zone far from Prague, so every date and time shown must be Prague's
// whatever the browser's zone. It covers the events page grouped by year, newest first, its links,
// safe rendering, the diary's event-only days and the time spent at an event, the keyboard, widths,
// themes, axe and touch targets, event writes reaching the warmed events page and the old and new
// diary days through the signed invalidation, no events on the main stack and the unavailable state.
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

const eventsPage = "/ai-roadmap/events";
const diary = "/ai-roadmap/diary";
// A day covered only by the summit: no notes, no time.
const eventOnlyDay = `${diary}/2026-01-01`;
// A summit day with time spent at it.
const attendanceDay = `${diary}/2025-12-31`;
// The summit's last day: notes, a study session and time at the summit.
const mixedDay = `${diary}/2026-01-02`;
const unsafeDay = `${diary}/2025-06-10`;

// Far from Prague on both sides of the date line: a time shown in the browser's zone would differ.
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
// (docs/design.md, Components); links inside running text are not.
async function expectTouchTargets(page: Page) {
  const heights = await page
    .locator('nav[aria-label="AI Roadmap"] a, main a, main button')
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.checkVisibility() && element.closest("p") === null)
        .map((element) => ({
          target: element.outerHTML.slice(0, 160),
          height: element.getBoundingClientRect().height,
        })),
    );
  expect(heights.length).toBeGreaterThan(0);
  for (const { target, height } of heights) expect(height, target).toBeGreaterThanOrEqual(44);
}

function robots(page: Page) {
  return page.locator('meta[name="robots"]').getAttribute("content");
}

test.describe.configure({ mode: "serial" });

test.describe("the roadmap's events", () => {
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
    api = await startApi("with-events", {
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

  async function status(path: string): Promise<number> {
    const response = await fetch(`${website.url}${path}`);
    await response.body?.cancel();
    return response.status;
  }

  test("lists every event newest first, grouped by the year it starts in, kept out of search results", async ({
    page,
  }) => {
    const response = await page.goto(`${website.url}${eventsPage}`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`Events — AI Roadmap — ${name}`);
    expect(await robots(page)).toContain("noindex");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Events");
    await expect(
      page.getByRole("navigation", { name: "AI Roadmap" }).locator('[aria-current="page"]'),
    ).toHaveText("Events");

    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["2026", "2025", "2024"]);
    await expect(page.getByRole("heading", { level: 3 })).toHaveText([
      "Spring signals lecture (opens in a new tab)",
      "New Year Orbit Summit (opens in a new tab)",
      "Unsafe retry workshop",
      "Quiet queue meetup",
    ]);
    // The summit starts in 2025, so it stays in that year although it ends in 2026.
    const year2025 = page.getByRole("list", { name: "Events in 2025" }).locator(":scope > li");
    await expect(year2025).toHaveCount(2);

    const summit = year2025.first();
    await expect(summit).toContainText("December 30, 2025 – January 2, 2026");
    await expect(summit).toContainText("Conference");
    await expect(summit).toContainText(
      "A fictional guild of orbit engineers · Testville Congress Hall · 3h 30m attended",
    );
    await expect(summit.locator("strong")).toHaveText("orbit signals");
    await expect(summit).toContainText("Topics: Orbit signals, Calm retries");
    await expect(summit.locator("time").first()).toHaveAttribute("datetime", "2025-12-30");

    const lecture = page.getByRole("list", { name: "Events in 2026" }).locator(":scope > li");
    await expect(lecture).toContainText("March 4, 2026");
    await expect(lecture).toContainText("Lecture");
    await expect(lecture).toContainText("The fictional Orbit Society · Online");

    // A bare event shows only what is known: no details, takeaways, topics or time.
    const meetup = page.getByRole("list", { name: "Events in 2024" }).locator(":scope > li");
    await expect(meetup).toContainText("May 14, 2024");
    await expect(meetup).not.toContainText("Topics:");
    await expect(meetup).not.toContainText("attended");
  });

  test("an event's link opens in a new tab and each event leads to its first diary day", async ({
    page,
  }) => {
    await page.goto(`${website.url}${eventsPage}`);
    const summit = page.getByRole("link", { name: /^New Year Orbit Summit/u });
    await expect(summit).toHaveAttribute(
      "href",
      "https://events.example.test/new-year-orbit-summit",
    );
    await expect(summit).toHaveAttribute("target", "_blank");
    await expect(summit).toHaveAttribute("rel", "noopener noreferrer");
    await expect(page.getByRole("link", { name: /^Unsafe retry workshop/u })).toHaveCount(0);

    await expect(
      page.getByRole("link", { name: "In the learning diary: New Year Orbit Summit" }),
    ).toHaveAttribute("href", `${diary}/2025-12-30`);
    await expect(
      page.getByRole("link", { name: "In the learning diary: Quiet queue meetup" }),
    ).toHaveAttribute("href", `${diary}/2024-05-14`);
  });

  test("the diary lists the days covered only by an event, each with the events covering it", async ({
    page,
  }) => {
    await page.goto(`${website.url}${diary}`);
    const days = page.getByRole("list", { name: "Diary days" }).locator(":scope > li h2");
    await expect(days).toHaveText([
      "Wednesday, March 4, 2026",
      "Friday, January 2, 2026",
      "Thursday, January 1, 2026",
      "Wednesday, December 31, 2025",
      "Tuesday, December 30, 2025",
      "Tuesday, June 10, 2025",
      "Tuesday, May 14, 2024",
    ]);
    await expect(
      page.getByRole("list", { name: "Events on Thursday, January 1, 2026" }),
    ).toHaveText("New Year Orbit Summit · Conference · Day 3 of 4");
    await expect(page.getByRole("list", { name: "Events on Wednesday, March 4, 2026" })).toHaveText(
      "Spring signals lecture · Lecture",
    );
    for (const path of [eventOnlyDay, `${diary}/2026-03-04`, `${diary}/2024-05-14`]) {
      expect(await status(path), path).toBe(200);
    }
  });

  test("a day covered only by an event shows the event without notes or time", async ({ page }) => {
    const response = await page.goto(`${website.url}${eventOnlyDay}`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(
      `Thursday, January 1, 2026 — Learning Diary — AI Roadmap — ${name}`,
    );
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Events");
    await expect(page.locator("main")).not.toContainText("What I worked on");
    await expect(page.locator("main")).not.toContainText("session");
    await expect(page.getByRole("heading", { level: 3 })).toHaveText(
      "New Year Orbit Summit (opens in a new tab)",
    );
    await expect(page.locator("main")).toContainText(
      "Day 3 of 4 · December 30, 2025 – January 2, 2026",
    );
    await expect(page.getByRole("list", { name: "Time at New Year Orbit Summit" })).toHaveCount(0);
  });

  test("the time spent at an event shows on its day at Prague times, apart from study sessions", async ({
    page,
  }) => {
    await page.goto(`${website.url}${attendanceDay}`);
    await expect(page.locator("main")).not.toContainText("What I worked on");
    const time = page.getByRole("list", { name: "Time at New Year Orbit Summit" });
    await expect(time.getByRole("listitem")).toHaveText([/10:00 – 12:30\s*\(2h 30m\)/u]);
    await expect(time.locator("time").first()).toHaveAttribute(
      "datetime",
      "2025-12-31T09:00:00.000Z",
    );

    await page.goto(`${website.url}${mixedDay}`);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "What I worked on",
      "Events",
    ]);
    await expect(
      page.getByRole("list", { name: "Sessions in Signal basics" }).getByRole("listitem"),
    ).toHaveText([/19:00 – 19:45\s*\(45 min\)\s*A fictional signal explainer/u]);
    await expect(
      page.getByRole("list", { name: "Time at New Year Orbit Summit" }).getByRole("listitem"),
    ).toHaveText([/09:00 – 10:00\s*\(1h\)/u]);
    await expect(page.locator("main")).toContainText("Day 4 of 4");
  });

  test("renders takeaways as text: no script, image, raw markup or javascript: link", async ({
    page,
  }) => {
    await page.goto(`${website.url}${eventsPage}`);
    const main = page.locator("main");
    await expect(main).toContainText("a trap");
    await expect(main.locator("script, img, b, iframe")).toHaveCount(0);
    await expect(page.locator('main a[href^="javascript:"]')).toHaveCount(0);
    expect(await page.evaluate(() => "__eventsInjected" in window)).toBe(false);
    await page.setViewportSize({ width: 360, height: 800 });
    await expectNoHorizontalScroll(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // The diary day shows the event's name, never its takeaways.
    await page.goto(`${website.url}${unsafeDay}`);
    await expect(page.locator("main")).toContainText("Unsafe retry workshop");
    await expect(page.locator("main")).not.toContainText("a trap");
  });

  test("the keyboard reaches an event's diary day from the events page", async ({ page }) => {
    await page.goto(`${website.url}${eventsPage}`);
    const lecture = page.getByRole("link", { name: /^Spring signals lecture/u });
    for (let step = 0; step < 30; step += 1) {
      await page.keyboard.press("Tab");
      if (await lecture.evaluate((element) => element === document.activeElement)) break;
    }
    await expect(lecture).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "In the learning diary: Spring signals lecture" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${website.url}${diary}/2026-03-04`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wednesday, March 4, 2026");
  });

  test("fits every width and mode, accessible and with large targets", async ({ page }) => {
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [label, path] of [
        ["list", eventsPage],
        ["diary", diary],
        ["event-only-day", eventOnlyDay],
        ["mixed-day", mixedDay],
      ] as const) {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(`${website.url}${path}`);
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          await expectNoHorizontalScroll(page);
          await expectTouchTargets(page);
          await page.screenshot({
            path: test.info().outputPath(`events-${label}-${String(width)}-${scheme}.png`),
            fullPage: true,
          });
          if (width === 360 || width === 1280) await expectAccessible(page);
        }
      }
    }
  });

  test("event writes reach the warmed events page and the old and new diary days", async () => {
    const oldDay = `${diary}/2025-11-05`;
    const newDay = `${diary}/2025-11-07`;
    const lastDay = `${diary}/2025-11-08`;
    // Warm every page the writes will change, days that do not exist yet included.
    expect(await text(eventsPage)).not.toContain("Autumn signal evening");
    expect(await text(diary)).not.toContain("November 5, 2025");
    expect(await status(oldDay)).toBe(404);
    expect(await status(newDay)).toBe(404);

    await write("POST", "/v1/roadmap/events", {
      slug: "autumn-signal-evening",
      name: "Autumn signal evening",
      kind: "meetup",
      startsOn: "2025-11-05",
      endsOn: "2025-11-05",
    });
    await expect.poll(() => text(eventsPage), within).toContain("Autumn signal evening");
    await expect.poll(() => status(oldDay), within).toBe(200);
    expect(await text(oldDay)).toContain("Autumn signal evening");
    await expect.poll(() => text(diary), within).toContain("Wednesday, November 5, 2025");

    // Moving it to two other days empties the old day and fills the new ones.
    await write("PATCH", "/v1/roadmap/events/autumn-signal-evening", {
      startsOn: "2025-11-07",
      endsOn: "2025-11-08",
    });
    await expect.poll(() => status(oldDay), within).toBe(404);
    await expect.poll(() => status(newDay), within).toBe(200);
    expect(await text(newDay)).toContain("Day 1 of 2");
    expect(await text(lastDay)).toContain("Day 2 of 2");
    await expect.poll(() => text(eventsPage), within).toContain("November 7–8, 2025");
    await expect.poll(() => text(diary), within).not.toContain("Wednesday, November 5, 2025");

    // Deleting it removes it from the events page and both days.
    await write("DELETE", "/v1/roadmap/events/autumn-signal-evening");
    await expect.poll(() => status(newDay), within).toBe(404);
    await expect.poll(() => status(lastDay), within).toBe(404);
    await expect.poll(() => text(eventsPage), within).not.toContain("Autumn signal evening");
    expect(await text(diary)).not.toContain("Friday, November 7, 2025");
  });
});

test.describe("no events", () => {
  // The main stack's fixture (with-photo) has a profile and no event.
  test("says there are no events yet", async ({ page }) => {
    const response = await page.goto(eventsPage);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Events");
    await expect(page.locator("main")).toContainText("No events yet.");
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
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

  test("the events page shows the unavailable state, never empty", async ({ page }) => {
    const response = await page.goto(`${website.url}${eventsPage}`);
    expect(response?.status()).toBe(500);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(unavailable);
    await expect(page.locator("main")).not.toContainText("No events yet.");
    await expectAccessible(page);
  });
});
