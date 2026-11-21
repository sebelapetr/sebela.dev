// The learning diary against the fictional diary of e2e/fixtures/with-diary/ (Robin Ashby): a day
// with four sessions across two areas and Markdown notes, the next day holding only the after-
// midnight half of a session split at Prague midnight, a notes-only day, and the night the clocks
// went back with notes that try to inject markup. The browser runs in a time zone far from Prague,
// so every date and time shown must be Prague's whatever the browser's zone. It covers the list
// and day pages' content, the sessions' grouping and links, a missing or impossible day, safe
// rendering, the keyboard, widths, themes, axe and touch targets, diary writes reaching the warmed
// list and the old and new day pages through the signed invalidation, the empty diary of the main
// stack and the unavailable state.
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

const busyDay = "/ai-roadmap/diary/2026-03-02";
const nextDay = "/ai-roadmap/diary/2026-03-03";
const notesOnlyDay = "/ai-roadmap/diary/2026-03-01";
const clocksBackDay = "/ai-roadmap/diary/2025-10-26";

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

// The page's robots tag; roadmap pages are indexed, so it is absent.
function robots(page: Page) {
  return page.locator('meta[name="robots"]');
}

function days(page: Page) {
  return page.getByRole("list", { name: "Diary days" }).locator(":scope > li");
}

test.describe.configure({ mode: "serial" });

test.describe("the learning diary", () => {
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
    api = await startApi("with-diary", {
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

  test("lists every day newest first with its study time, sessions and notes, open to search engines", async ({
    page,
  }) => {
    const response = await page.goto(`${website.url}/ai-roadmap/diary`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`Learning Diary · AI Engineering Roadmap · ${name}`);
    await expect(robots(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Learning Diary");
    await expect(
      page.getByRole("navigation", { name: "AI Roadmap" }).locator('[aria-current="page"]'),
    ).toHaveText("Learning Diary");

    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Tuesday, March 3, 2026",
      "Monday, March 2, 2026",
      "Sunday, March 1, 2026",
      "Sunday, October 26, 2025",
    ]);
    await expect(days(page).nth(0)).toContainText("30 min · 1 session");
    await expect(days(page).nth(1)).toContainText("3h 5m · 4 sessions");
    await expect(days(page).nth(1)).toContainText("Compared two made-up retry styles");
    // A notes-only day shows its notes and no study time.
    await expect(days(page).nth(2)).toContainText("A notes-only day");
    await expect(days(page).nth(2)).not.toContainText(/\d+ sessions?/u);
    await expect(days(page).nth(3)).toContainText("2h · 1 session");
    await expect(page.getByRole("link", { name: "Monday, March 2, 2026" })).toHaveAttribute(
      "href",
      busyDay,
    );
    await expect(page.locator("main")).not.toContainText("No diary entries yet.");
  });

  test("a day shows its notes and what was studied when at Prague times, by area and module", async ({
    page,
  }) => {
    const response = await page.goto(`${website.url}${busyDay}`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`Monday, March 2, 2026 · Learning Diary · ${name}`);
    await expect(robots(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Monday, March 2, 2026");
    await expect(page.locator("main")).toContainText("3h 5m · 4 sessions");
    await expect(page.locator("main strong")).toHaveText("fictional signals");
    await expect(page.getByRole("link", { name: "the fictional guide" })).toHaveAttribute(
      "href",
      "https://learn.example.test/signal-explainer",
    );

    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("listitem")).toHaveText([
      "AI Engineering Roadmap",
      "Learning Diary",
      "Monday, March 2, 2026",
    ]);
    await expect(crumbs.getByRole("link", { name: "Learning Diary" })).toHaveAttribute(
      "href",
      "/ai-roadmap/diary",
    );

    await expect(page.getByRole("heading", { level: 2 })).toHaveText("What I worked on");
    // Areas and modules in the roadmap's order, each leading to its own page.
    await expect(page.getByRole("heading", { level: 3 })).toHaveText([
      "Orbit foundations",
      "Quiet systems",
    ]);
    await expect(page.getByRole("heading", { level: 4 })).toHaveText([
      "Signal basics",
      "Calm queues",
    ]);
    await expect(page.getByRole("link", { name: "Orbit foundations" })).toHaveAttribute(
      "href",
      "/ai-roadmap/orbit-foundations",
    );
    await expect(page.getByRole("link", { name: "Calm queues" })).toHaveAttribute(
      "href",
      "/ai-roadmap/quiet-systems/calm-queues",
    );

    // Each module's sessions by their start, at Prague times; the late one ends at Prague midnight.
    const signals = page.getByRole("list", { name: "Sessions in Signal basics" });
    await expect(signals.getByRole("listitem")).toHaveText([
      /08:05 – 09:35\s*\(1h 30m\)\s*A fictional signal explainer.*Video/u,
      /14:00 – 14:20\s*\(20 min\)\s*Unsafe signal notes\s*Text/u,
      /23:30 – 00:00\s*\(30 min\)\s*A fictional book on signals\s*Book/u,
    ]);
    await expect(
      page.getByRole("list", { name: "Sessions in Calm queues" }).getByRole("listitem"),
    ).toHaveText([/10:00 – 10:45\s*\(45 min\)\s*A fictional queue guide/u]);
    await expect(signals.locator("time").first()).toHaveAttribute(
      "datetime",
      "2026-03-02T07:05:00.000Z",
    );

    // A resource with a link opens it in a new tab; one without is plain text.
    const explainer = signals.getByRole("link", { name: /A fictional signal explainer/u });
    await expect(explainer).toHaveAttribute("href", "https://learn.example.test/signal-explainer");
    await expect(explainer).toHaveAttribute("target", "_blank");
    await expect(explainer).toHaveAttribute("rel", "noopener noreferrer");
    await expect(signals.getByRole("link", { name: /Unsafe signal notes/u })).toHaveCount(0);
  });

  test("a session across Prague midnight continues on the next day, and the clocks going back count real time", async ({
    page,
  }) => {
    await page.goto(`${website.url}${nextDay}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tuesday, March 3, 2026");
    await expect(page.locator("main")).toContainText("30 min · 1 session");
    await expect(page.getByRole("list", { name: "Sessions in Signal basics" })).toContainText(
      "00:00 – 00:30",
    );

    await page.goto(`${website.url}${clocksBackDay}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sunday, October 26, 2025");
    await expect(page.locator("main")).toContainText("2h · 1 session");
    await expect(page.getByRole("list", { name: "Sessions in Signal basics" })).toContainText(
      /01:30 – 02:30\s*\(2h\)/u,
    );
  });

  test("a notes-only day shows its notes without study time or sessions", async ({ page }) => {
    const response = await page.goto(`${website.url}${notesOnlyDay}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sunday, March 1, 2026");
    await expect(page.locator("main")).toContainText("A notes-only day");
    await expect(page.locator("main em")).toHaveText("thinking");
    await expect(page.locator("main")).not.toContainText(/\d+ sessions?/u);
    await expect(page.getByRole("heading", { name: "What I worked on" })).toHaveCount(0);
  });

  test("a day without a record, an impossible date or an address that is not a date is not found", async ({
    page,
  }) => {
    for (const path of [
      "/ai-roadmap/diary/2026-01-15",
      "/ai-roadmap/diary/2026-02-30",
      "/ai-roadmap/diary/not-a-date",
      "/ai-roadmap/diary/2026-03-02%2F..",
    ]) {
      const response = await page.goto(`${website.url}${path}`);
      expect(response?.status(), path).toBe(404);
    }
  });

  test("renders notes as text: no script, image, raw markup or javascript: link", async ({
    page,
  }) => {
    for (const path of ["/ai-roadmap/diary", clocksBackDay]) {
      await page.goto(`${website.url}${path}`);
      const main = page.locator("main");
      await expect(main).toContainText("a trap");
      await expect(main.locator("script, img, b, iframe")).toHaveCount(0);
      await expect(page.locator('main a[href^="javascript:"]')).toHaveCount(0);
      expect(await page.evaluate(() => "__diaryInjected" in window)).toBe(false);
      await page.setViewportSize({ width: 360, height: 800 });
      await expectNoHorizontalScroll(page);
      await page.setViewportSize({ width: 1280, height: 800 });
    }
  });

  test("the keyboard reaches a day from the list and the breadcrumbs lead back", async ({
    page,
  }) => {
    await page.goto(`${website.url}/ai-roadmap/diary`);
    const first = page.getByRole("link", { name: "Tuesday, March 3, 2026" });
    for (let step = 0; step < 30; step += 1) {
      await page.keyboard.press("Tab");
      if (await first.evaluate((element) => element === document.activeElement)) break;
    }
    await expect(first).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Monday, March 2, 2026" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${website.url}${busyDay}`);

    const back = page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Learning Diary" });
    await back.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${website.url}/ai-roadmap/diary`);
  });

  test("fits every width and mode, accessible and with large targets", async ({ page }) => {
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [label, path] of [
        ["list", "/ai-roadmap/diary"],
        ["day", busyDay],
        ["notes-only", notesOnlyDay],
      ] as const) {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(`${website.url}${path}`);
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          await expectNoHorizontalScroll(page);
          await expectTouchTargets(page);
          await page.screenshot({
            path: test.info().outputPath(`diary-${label}-${String(width)}-${scheme}.png`),
            fullPage: true,
          });
          if (width === 360 || width === 1280) await expectAccessible(page);
        }
      }
    }
  });

  test("diary writes reach the warmed list and the old and new day pages", async () => {
    const newDay = "/ai-roadmap/diary/2026-03-04";
    // Warm every page the writes will change, a day that does not exist yet included.
    expect(await text("/ai-roadmap/diary")).toContain("A notes-only day");
    expect(await text(notesOnlyDay)).not.toContain("What I worked on");
    expect(await status(newDay)).toBe(404);

    await write("PATCH", "/v1/roadmap/diary/2026-03-01", { notes: "Rewritten fictional notes." });
    await expect.poll(() => text(notesOnlyDay), within).toContain("Rewritten fictional notes.");
    await expect.poll(() => text("/ai-roadmap/diary"), within).toContain("Rewritten fictional");

    const created = (await write("POST", "/v1/roadmap/time-entries", {
      resource: "queue-guide",
      startedAt: "2026-03-01T09:00:00+01:00",
      endedAt: "2026-03-01T09:40:00+01:00",
    })) as { entries: { id: string }[] };
    const id = created.entries[0]?.id ?? "";
    await expect.poll(() => text(notesOnlyDay), within).toContain("40 min · 1 session");
    await expect.poll(() => text("/ai-roadmap/diary"), within).toContain("40 min · 1 session");

    // Moving the session to another day changes the old day and creates the new one.
    await write("PATCH", `/v1/roadmap/time-entries/${id}`, {
      startedAt: "2026-03-04T18:00:00+01:00",
      endedAt: "2026-03-04T18:15:00+01:00",
    });
    await expect.poll(() => text(notesOnlyDay), within).not.toContain("What I worked on");
    await expect.poll(() => status(newDay), within).toBe(200);
    expect(await text(newDay)).toContain("15 min · 1 session");
    await expect
      .poll(() => text("/ai-roadmap/diary"), within)
      .toContain("Wednesday, March 4, 2026");

    // Deleting it and the notes removes both days.
    await write("DELETE", `/v1/roadmap/time-entries/${id}`);
    await write("DELETE", "/v1/roadmap/diary/2026-03-01");
    await expect.poll(() => status(newDay), within).toBe(404);
    await expect.poll(() => status(notesOnlyDay), within).toBe(404);
    const list = await text("/ai-roadmap/diary");
    expect(list).not.toContain("Wednesday, March 4, 2026");
    expect(list).not.toContain("Sunday, March 1, 2026");
  });
});

test.describe("an empty diary", () => {
  // The main stack's fixture (with-photo) has a profile and no diary day.
  test("says there are no entries yet", async ({ page }) => {
    const response = await page.goto("/ai-roadmap/diary");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Learning Diary");
    await expect(page.locator("main")).toContainText("No diary entries yet.");
    await expect(page.getByRole("list", { name: "Diary days" })).toHaveCount(0);
    const day = await page.goto("/ai-roadmap/diary/2026-03-02");
    expect(day?.status()).toBe(404);
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

  test("the list and a day show the unavailable state, never empty or not found", async ({
    page,
  }) => {
    for (const path of ["/ai-roadmap/diary", busyDay]) {
      const response = await page.goto(`${website.url}${path}`);
      expect(response?.status(), path).toBe(500);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(unavailable);
    }
    await expectAccessible(page);
  });
});
