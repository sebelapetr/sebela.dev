import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MediaSchema,
  invalidationHeaders,
  verifyInvalidationNotification,
  type ContentChange,
  type InvalidationVerification,
} from "@sebela/contracts";
import { samplePng } from "@sebela/services/testing";

import { createApp } from "./app.js";
import {
  createWebsiteInvalidation,
  type WebsiteInvalidation,
  type WebsiteInvalidationOptions,
} from "./modules/invalidation/index.js";
import {
  bearer,
  connection,
  json,
  openTestBackend,
  testConfig,
  upload,
  type TestBackend,
} from "./test-support.js";

// A disposable fixture secret and a fictional destination; nothing here is real.
const SECRET = "fixture-invalidation-secret-0123456789";
const DESTINATION = "https://web.example.test/api/invalidate";
const NOW = Date.parse("2026-05-04T10:00:00.000Z");

const change: ContentChange = { domain: "experience", record: "northwind-lead", action: "updated" };

/** One request the sender made, as the website would receive it. */
interface Delivery {
  readonly url: string;
  readonly init: RequestInit;
  readonly body: Uint8Array;
  readonly headers: Headers;
}

const verify = (delivery: Delivery, now = NOW): Promise<InvalidationVerification> =>
  verifyInvalidationNotification({
    secret: SECRET,
    body: delivery.body,
    timestamp: delivery.headers.get(invalidationHeaders.timestamp),
    signature: delivery.headers.get(invalidationHeaders.signature),
    now,
  });

/** An answer, or a failure, for one attempt; `"hang"` waits until the attempt is aborted. */
type Outcome = number | Error | "hang";

/** A fetch that records each request and answers with the next outcome (the last one repeats). */
function fakeWebsite(...outcomes: Outcome[]) {
  const deliveries: Delivery[] = [];
  const fetch = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const outcome = outcomes[Math.min(deliveries.length, outcomes.length - 1)] ?? 204;
    deliveries.push({
      url: input instanceof Request ? input.url : input.toString(),
      init,
      body: new Uint8Array(init.body as Uint8Array),
      headers: new Headers(init.headers),
    });
    if (outcome instanceof Error) return Promise.reject(outcome);
    if (init.signal?.aborted) return Promise.reject(init.signal.reason as Error);
    if (outcome === "hang") {
      return new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason as Error);
        });
      });
    }
    return Promise.resolve(
      new Response(outcome === 204 ? null : "fictional answer", { status: outcome }),
    );
  };
  const website: { deliveries: Delivery[]; fetch: typeof globalThis.fetch } = { deliveries, fetch };
  return website;
}

describe("the website invalidation sender", () => {
  let lines: string[];
  let sender: WebsiteInvalidation | undefined;
  let ids: number;

  const start = (
    website: { fetch: typeof globalThis.fetch },
    options: Partial<WebsiteInvalidationOptions> = {},
  ) => {
    sender = createWebsiteInvalidation({
      url: DESTINATION,
      secret: SECRET,
      log: (line) => lines.push(line),
      fetch: website.fetch,
      now: () => NOW,
      randomId: () => `0b9f2c1e-4a77-4c3d-9a51-${String(ids++).padStart(12, "0")}`,
      timeoutMs: 50,
      retryDelaysMs: [1, 1],
      ...options,
    });
    return sender;
  };

  beforeEach(() => {
    lines = [];
    ids = 1;
  });

  afterEach(async () => {
    await sender?.close();
    sender = undefined;
    for (const line of lines) {
      expect(line).not.toContain(SECRET);
      expect(line).not.toContain("web.example.test");
    }
  });

  it("posts the change, signed over the exact body bytes and the timestamp", async () => {
    const website = fakeWebsite(204);
    const invalidation = start(website);

    await invalidation.notify({ change });
    await invalidation.idle();

    expect(website.deliveries).toHaveLength(1);
    const [delivery] = website.deliveries;
    if (!delivery) throw new Error("nothing was delivered");
    expect(delivery.url).toBe(DESTINATION);
    expect(delivery.init.method).toBe("POST");
    expect(delivery.init.redirect).toBe("manual");
    expect(delivery.headers.get("content-type")).toBe("application/json");
    expect(await verify(delivery)).toEqual({
      ok: true,
      notification: {
        eventId: "0b9f2c1e-4a77-4c3d-9a51-000000000001",
        occurredAt: "2026-05-04T10:00:00.000Z",
        changes: [change],
      },
    });
  });

  it("returns before the website answers, so a write is never delayed by it", async () => {
    const website = fakeWebsite("hang");
    const invalidation = start(website, { timeoutMs: 60_000 });

    await invalidation.notify({ change });

    expect(website.deliveries.length).toBeLessThanOrEqual(1);
  });

  it("retries a failed delivery with the same event and body, then gives up", async () => {
    const website = fakeWebsite(503, new TypeError("fetch failed"), 500);
    const invalidation = start(website);

    await invalidation.notify({ change });
    await invalidation.idle();

    expect(website.deliveries).toHaveLength(3);
    const [first, ...rest] = website.deliveries;
    if (!first) throw new Error("nothing was delivered");
    for (const retry of rest) {
      expect(retry.body).toEqual(first.body);
      expect((await verify(retry)).ok).toBe(true);
    }
    expect(lines.join("\n")).toMatch(/gave up/);
    expect(lines.join("\n")).toContain("0b9f2c1e-4a77-4c3d-9a51-000000000001");
  });

  it("succeeds on a retry after a rate-limited or failed attempt", async () => {
    const website = fakeWebsite(429, 204);
    const invalidation = start(website);

    await invalidation.notify({ change });
    await invalidation.idle();

    expect(website.deliveries).toHaveLength(2);
    expect(lines.join("\n")).not.toMatch(/gave up/);
  });

  it("does not retry a refusal or a redirect", async () => {
    for (const status of [400, 401, 413, 302]) {
      const website = fakeWebsite(status, 204);
      const invalidation = start(website);

      await invalidation.notify({ change });
      await invalidation.idle();
      await invalidation.close();

      expect(website.deliveries, String(status)).toHaveLength(1);
    }
    expect(lines.join("\n")).toMatch(/401/);
  });

  it("abandons an attempt that takes longer than the timeout", async () => {
    const website = fakeWebsite("hang");
    const invalidation = start(website, { timeoutMs: 20 });

    const started = Date.now();
    await invalidation.notify({ change });
    await invalidation.idle();

    expect(website.deliveries).toHaveLength(3);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(lines.join("\n")).toMatch(/TimeoutError/);
  });

  it("keeps at most the queue limit waiting and drops what does not fit", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const website = fakeWebsite(204);
    const fetch: typeof globalThis.fetch = async (input, init) => {
      await gate;
      return website.fetch(input, init);
    };
    const invalidation = start({ fetch }, { queueLimit: 3, timeoutMs: 60_000 });

    for (let index = 0; index < 10; index += 1) await invalidation.notify({ change });
    release();
    await invalidation.idle();

    // One in flight while the others arrived, three waiting; the other six were dropped.
    expect(website.deliveries).toHaveLength(4);
    expect(lines.filter((line) => line.includes("dropped"))).toHaveLength(6);
  });

  it("skips and logs a change that is not a valid notification", async () => {
    const website = fakeWebsite(204);
    const invalidation = start(website);

    await invalidation.notify({
      change: { domain: "experience", record: "../person", action: "updated" },
    });
    await invalidation.idle();

    expect(website.deliveries).toHaveLength(0);
    expect(lines.join("\n")).toMatch(/invalid/);
  });

  it("stops on close: aborts the delivery in flight and sends nothing more", async () => {
    const website = fakeWebsite("hang");
    const invalidation = start(website, { timeoutMs: 60_000 });

    await invalidation.notify({ change });
    await invalidation.notify({ change });
    await vi.waitFor(() => {
      expect(website.deliveries).toHaveLength(1);
    });
    await invalidation.close();
    await invalidation.notify({ change });
    await invalidation.idle();

    expect(website.deliveries).toHaveLength(1);
  });

  it("spends the documented default budget: three attempts of 2 s at most, 250 ms and then 1 s apart", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // Each attempt's own timeout is an `AbortSignal.timeout`, which fake timers do not reach.
    const timeouts = vi.spyOn(AbortSignal, "timeout");
    // \`vi.waitFor\` advances fake time while it polls, which would move past the retry delays;
    // this waits on \`setImmediate\`, which is not faked, so the clock moves only when told to.
    const deliveredWithoutTime = async (deliveries: unknown[], count: number) => {
      for (let turn = 0; turn < 1_000 && deliveries.length < count; turn += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(deliveries).toHaveLength(count);
    };
    try {
      const website = fakeWebsite(new TypeError("fetch failed"));
      // The defaults, not the short budget of `start`.
      const invalidation = createWebsiteInvalidation({
        url: DESTINATION,
        secret: SECRET,
        log: (line) => lines.push(line),
        fetch: website.fetch,
        now: () => NOW,
        randomId: () => "0b9f2c1e-4a77-4c3d-9a51-000000000001",
      });
      sender = invalidation;

      await invalidation.notify({ change });
      await deliveredWithoutTime(website.deliveries, 1);
      await vi.advanceTimersByTimeAsync(249);
      expect(website.deliveries).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      await deliveredWithoutTime(website.deliveries, 2);
      await vi.advanceTimersByTimeAsync(999);
      expect(website.deliveries).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      await deliveredWithoutTime(website.deliveries, 3);
      await invalidation.idle();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(website.deliveries).toHaveLength(3);
      expect(lines).toEqual([
        "website invalidation 0b9f2c1e-4a77-4c3d-9a51-000000000001 attempt 1 failed: TypeError",
        "website invalidation 0b9f2c1e-4a77-4c3d-9a51-000000000001 attempt 2 failed: TypeError",
        "website invalidation 0b9f2c1e-4a77-4c3d-9a51-000000000001 attempt 3 failed: TypeError",
        "website invalidation 0b9f2c1e-4a77-4c3d-9a51-000000000001 gave up after 3 attempts",
      ]);
      expect(timeouts.mock.calls).toEqual([[2000], [2000], [2000]]);
    } finally {
      timeouts.mockRestore();
      vi.useRealTimers();
    }
  });

  it("delivers a repeated change as a new event each time", async () => {
    const website = fakeWebsite(204);
    const invalidation = start(website);

    await invalidation.notify({ change });
    await invalidation.notify({ change });
    await invalidation.idle();

    const ids = [];
    for (const delivery of website.deliveries) {
      const verification = await verify(delivery);
      if (!verification.ok) throw new Error(`refused: ${verification.reason}`);
      expect(verification.notification.changes).toEqual([change]);
      ids.push(verification.notification.eventId);
    }
    expect(new Set(ids).size).toBe(2);
  });

  it("refuses a secret shorter than the minimum when it is created", () => {
    expect(() => start(fakeWebsite(204), { secret: "short-fixture-secret" })).toThrow(/secret/);
  });
});

describe("the website invalidation sender over HTTP", () => {
  const host = process.env["API_HOST"];
  let server: Server;
  let received: { body: Buffer; request: IncomingMessage }[];
  let answer: "ok" | "hang";
  let destination: string;

  beforeAll(async () => {
    if (!host) throw new Error("API_HOST is not set (documented in .env.example)");
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received.push({ body: Buffer.concat(chunks), request });
        if (answer === "ok") response.writeHead(204).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const { port } = server.address() as AddressInfo;
    destination = `http://${host.includes(":") ? `[${host}]` : host}:${String(port)}/api/invalidate`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    received = [];
    answer = "ok";
  });

  it("delivers bytes the website verifies in one attempt", async () => {
    const lines: string[] = [];
    // A generous timeout: a slow runner must not turn the delivery into a timed-out retry.
    const invalidation = createWebsiteInvalidation({
      url: destination,
      secret: SECRET,
      log: (line) => lines.push(line),
      timeoutMs: 30_000,
      retryDelaysMs: [1, 1],
    });

    await invalidation.notify({ change });
    await invalidation.idle();
    await invalidation.close();

    expect(received).toHaveLength(1);
    expect(lines).toEqual([]);
    const [first] = received;
    if (!first) throw new Error("nothing was received");
    const header = (name: string) => {
      const value = first.request.headers[name];
      return typeof value === "string" ? value : null;
    };
    const verification = await verifyInvalidationNotification({
      secret: SECRET,
      body: first.body,
      timestamp: header(invalidationHeaders.timestamp),
      signature: header(invalidationHeaders.signature),
      now: Date.now(),
    });
    expect(verification).toMatchObject({ ok: true, notification: { changes: [change] } });
  });

  it("times out every attempt on a website that never answers, then gives up", async () => {
    answer = "hang";
    const lines: string[] = [];
    const invalidation = createWebsiteInvalidation({
      url: destination,
      secret: SECRET,
      log: (line) => lines.push(line),
      timeoutMs: 1000,
      retryDelaysMs: [1, 1],
    });

    await invalidation.notify({ change });
    await invalidation.idle();
    await invalidation.close();

    expect(received).toHaveLength(3);
    expect(lines).toHaveLength(4);
    expect(lines.slice(0, 3).every((line) => /attempt \d failed: TimeoutError$/.test(line))).toBe(
      true,
    );
    expect(lines[3]).toMatch(/gave up after 3 attempts$/);
  });
});

describe("notifying the website of committed content writes", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;
  let website: ReturnType<typeof fakeWebsite>;
  let invalidation: WebsiteInvalidation;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("invalidation")).key);
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    const { profile, media } = backend.services;
    for (const { slug } of await profile.listProjects()) {
      if ((await profile.getProject(slug)).caseStudy) await profile.deleteCaseStudy(slug);
      await profile.deleteProject(slug);
    }
    for (const { slug } of await profile.listExperiences()) await profile.deleteExperience(slug);
    for (const { slug } of await profile.listOrganizations()) {
      await profile.deleteOrganization(slug);
    }
    for (const { slug } of await profile.listTechnologies()) await profile.deleteTechnology(slug);
    for (const { id } of await media.listMedia()) await media.deleteMedia(id);
    website = fakeWebsite(204);
    invalidation = createWebsiteInvalidation({
      url: DESTINATION,
      secret: SECRET,
      log: () => undefined,
      fetch: website.fetch,
    });
  });

  afterEach(async () => {
    await invalidation.close();
  });

  const app = () => backend.api({ onWrite: invalidation.notify }).app;
  const send = (path: string, method: string, init: RequestInit = {}) =>
    app().request(path, { method, ...init }, connection());

  /** The changes the website received, each in a notification it verified. */
  async function delivered(): Promise<ContentChange[][]> {
    await invalidation.idle();
    const changes: ContentChange[][] = [];
    for (const delivery of website.deliveries) {
      const verification = await verify(delivery, Date.now());
      if (!verification.ok) throw new Error(`refused: ${verification.reason}`);
      changes.push(verification.notification.changes);
    }
    return changes;
  }

  const technology = { slug: "postgres", name: "Postgres", tier: "secondary", position: 0 };
  const organization = { slug: "northwind", name: "Northwind Logistics" };
  const experience = {
    slug: "northwind-lead",
    organization: "northwind",
    title: "Lead engineer",
    kind: "main_job",
    startedOn: "2021-03-01",
    summary: "Led a fictional routing team.",
    inCv: true,
  };
  const project = {
    slug: "routing-engine",
    experience: "northwind-lead",
    name: "Routing engine",
    summary: "A fictional routing engine.",
    problem: "Slow routes.",
    workDone: "Rewrote it.",
    result: "Faster routes.",
    startedOn: "2021-04-01",
    position: 0,
  };

  it("notifies each committed create, update and delete with the record it changed", async () => {
    expect((await send("/v1/technologies", "POST", json(technology, auth))).status).toBe(201);
    expect(
      (await send("/v1/technologies/postgres", "PATCH", json({ name: "PostgreSQL" }, auth))).status,
    ).toBe(200);
    expect((await send("/v1/organizations", "POST", json(organization, auth))).status).toBe(201);
    expect((await send("/v1/experiences", "POST", json(experience, auth))).status).toBe(201);
    expect((await send("/v1/projects", "POST", json(project, auth))).status).toBe(201);
    const caseStudy = { role: "Lead engineer.", body: "A fictional case study." };
    expect(
      (await send("/v1/projects/routing-engine/case-study", "POST", json(caseStudy, auth))).status,
    ).toBe(201);
    expect(
      (await send("/v1/projects/routing-engine/case-study", "DELETE", { headers: auth })).status,
    ).toBe(204);
    expect((await send("/v1/technologies/postgres", "DELETE", { headers: auth })).status).toBe(204);

    expect(await delivered()).toEqual([
      [{ domain: "technology", record: "postgres", action: "created" }],
      [{ domain: "technology", record: "postgres", action: "updated" }],
      [{ domain: "organization", record: "northwind", action: "created" }],
      [{ domain: "experience", record: "northwind-lead", action: "created" }],
      [{ domain: "project", record: "routing-engine", action: "created" }],
      [{ domain: "case-study", record: "routing-engine", action: "created" }],
      [{ domain: "case-study", record: "routing-engine", action: "deleted" }],
      [{ domain: "technology", record: "postgres", action: "deleted" }],
    ]);
    expect(new Set(website.deliveries.map((delivery) => delivery.body.toString())).size).toBe(8);
  });

  it("names the person without a record and media by identifier", async () => {
    const uploaded = await send(
      "/v1/media",
      "POST",
      upload({ bytes: samplePng({ width: 4, height: 3 }), name: "logo.png" }, {}, auth),
    );
    expect(uploaded.status).toBe(201);
    const { id } = MediaSchema.parse(await uploaded.json());
    expect((await send(`/v1/media/${id}`, "PATCH", json({ altText: "Logo" }, auth))).status).toBe(
      200,
    );
    expect((await send(`/v1/media/${id}`, "DELETE", { headers: auth })).status).toBe(204);

    expect(await delivered()).toEqual([
      [{ domain: "media", record: id, action: "created" }],
      [{ domain: "media", record: id, action: "updated" }],
      [{ domain: "media", record: id, action: "deleted" }],
    ]);
  });

  it("names each diary day a notes or time-entry write changed, old and new", async () => {
    const { roadmap } = backend.services;
    for (const day of (await roadmap.getDiary()).days) {
      for (const entry of day.entries) await roadmap.deleteTimeEntry(entry.id);
      if (day.notes !== null) await roadmap.deleteDiaryNotes(day.date);
    }
    if ((await roadmap.getRoadmap()).areas.length === 0) {
      // Set up without notifying.
      for (const [path, body] of [
        ["/v1/roadmap/areas", { slug: "basics", name: "Basics", weight: 100, position: 0 }],
        ["/v1/roadmap/modules", { slug: "prompting", area: "basics", name: "Prompt", position: 0 }],
        [
          "/v1/roadmap/resources",
          {
            slug: "prompting-guide",
            module: "prompting",
            name: "Guide",
            type: "link",
            position: 0,
          },
        ],
      ] as const) {
        const response = await backend
          .api()
          .app.request(path, { method: "POST", ...json(body, auth) }, connection());
        expect(response.status).toBe(201);
      }
    }

    const notes = json({ notes: "Late reading." }, auth);
    expect((await send("/v1/roadmap/diary/2026-03-02", "PATCH", notes)).status).toBe(200);
    const session = {
      resource: "prompting-guide",
      startedAt: "2026-03-02T23:30:00+01:00",
      endedAt: "2026-03-03T00:30:00+01:00",
    };
    const created = await send("/v1/roadmap/time-entries", "POST", json(session, auth));
    expect(created.status).toBe(201);
    const { entries } = (await created.json()) as { entries: { id: string }[] };
    const id = entries[0]?.id ?? "";
    const moved = { startedAt: "2026-03-05T08:00:00+01:00", endedAt: "2026-03-05T09:00:00+01:00" };
    expect((await send(`/v1/roadmap/time-entries/${id}`, "PATCH", json(moved, auth))).status).toBe(
      200,
    );
    expect((await send(`/v1/roadmap/time-entries/${id}`, "DELETE", { headers: auth })).status).toBe(
      204,
    );
    expect((await send("/v1/roadmap/diary/2026-03-02", "DELETE", { headers: auth })).status).toBe(
      204,
    );

    const day = (record: string, action: ContentChange["action"]) => [
      { domain: "roadmap-diary", record, action },
    ];
    expect(await delivered()).toEqual([
      day("2026-03-02", "updated"),
      day("2026-03-02", "created"),
      day("2026-03-03", "created"),
      day("2026-03-02", "updated"),
      day("2026-03-05", "updated"),
      day("2026-03-05", "deleted"),
      day("2026-03-02", "deleted"),
    ]);
  });

  it("names the book each bookshelf write changed", async () => {
    const book = { slug: "fictional-patterns", title: "Fictional Patterns" };
    expect((await send("/v1/roadmap/books", "POST", json(book, auth))).status).toBe(201);
    expect(
      (
        await send(
          "/v1/roadmap/books/fictional-patterns",
          "PATCH",
          json({ startedOn: "2026-03-02" }, auth),
        )
      ).status,
    ).toBe(200);
    expect(
      (await send("/v1/roadmap/books/fictional-patterns", "DELETE", { headers: auth })).status,
    ).toBe(204);

    expect(await delivered()).toEqual([
      [{ domain: "roadmap-book", record: "fictional-patterns", action: "created" }],
      [{ domain: "roadmap-book", record: "fictional-patterns", action: "updated" }],
      [{ domain: "roadmap-book", record: "fictional-patterns", action: "deleted" }],
    ]);
  });

  it("names the event each event write changed and the days attendance on it changed", async () => {
    const event = {
      slug: "fictional-summit",
      name: "Fictional Summit",
      kind: "conference",
      startsOn: "2026-04-01",
      endsOn: "2026-04-02",
    };
    expect((await send("/v1/roadmap/events", "POST", json(event, auth))).status).toBe(201);
    const moved = json({ startsOn: "2026-04-02", endsOn: "2026-04-03" }, auth);
    expect((await send("/v1/roadmap/events/fictional-summit", "PATCH", moved)).status).toBe(200);
    const session = {
      event: "fictional-summit",
      startedAt: "2026-04-02T09:00:00+02:00",
      endedAt: "2026-04-02T10:00:00+02:00",
    };
    const logged = await send("/v1/roadmap/time-entries", "POST", json(session, auth));
    expect(logged.status).toBe(201);
    const { entries } = (await logged.json()) as { entries: { id: string }[] };
    const id = entries[0]?.id ?? "";
    expect((await send(`/v1/roadmap/time-entries/${id}`, "DELETE", { headers: auth })).status).toBe(
      204,
    );
    expect(
      (await send("/v1/roadmap/events/fictional-summit", "DELETE", { headers: auth })).status,
    ).toBe(204);

    expect(await delivered()).toEqual([
      [{ domain: "roadmap-event", record: "fictional-summit", action: "created" }],
      [{ domain: "roadmap-event", record: "fictional-summit", action: "updated" }],
      [{ domain: "roadmap-diary", record: "2026-04-02", action: "created" }],
      [{ domain: "roadmap-diary", record: "2026-04-02", action: "deleted" }],
      [{ domain: "roadmap-event", record: "fictional-summit", action: "deleted" }],
    ]);
  });

  it("names the supporting record each project idea, followed source and term write changed", async () => {
    const writes = [
      ["project-ideas", { slug: "fictional-idea", title: "Idea", whyItMatters: "Why." }],
      ["followed-sources", { slug: "example-weekly", title: "Weekly", kind: "newsletter" }],
      ["glossary-terms", { slug: "context-window", term: "Context", description: "Text." }],
    ] as const;
    for (const [kind, body] of writes) {
      const path = `/v1/roadmap/${kind}`;
      expect((await send(path, "POST", json({ ...body, position: 0 }, auth))).status).toBe(201);
      const item = `${path}/${body.slug}`;
      expect((await send(item, "PATCH", json({ position: 1 }, auth))).status).toBe(200);
      expect((await send(item, "DELETE", { headers: auth })).status).toBe(204);
    }

    const change = (domain: string, record: string) =>
      (["created", "updated", "deleted"] as const).map((action) => [{ domain, record, action }]);
    expect(await delivered()).toEqual([
      ...change("roadmap-project-idea", "fictional-idea"),
      ...change("roadmap-followed-source", "example-weekly"),
      ...change("roadmap-glossary-term", "context-window"),
    ]);
  });

  it("sends nothing for a refused, invalid, conflicting or failed write, or a read", async () => {
    await send("/v1/technologies", "POST", json(technology, auth));
    await invalidation.idle();
    website.deliveries.length = 0;

    const statuses = [
      (await send("/v1/technologies", "POST", json(technology))).status,
      (await send("/v1/technologies", "POST", json({ ...technology, tier: "none" }, auth))).status,
      (await send("/v1/technologies", "POST", json(technology, auth))).status,
      (await send("/v1/technologies/unknown", "PATCH", json({ name: "Unknown" }, auth))).status,
      (await send("/v1/technologies/unknown", "DELETE", { headers: auth })).status,
      (await send("/v1/technologies/postgres", "GET")).status,
    ];

    expect(statuses).toEqual([401, 400, 409, 404, 404, 200]);
    expect(await delivered()).toEqual([]);
  });

  it("never fails or delays a write when the website is down", async () => {
    website = fakeWebsite(new TypeError("fetch failed"));
    await invalidation.close();
    invalidation = createWebsiteInvalidation({
      url: DESTINATION,
      secret: SECRET,
      log: () => undefined,
      fetch: website.fetch,
      retryDelaysMs: [1, 1],
    });

    const response = await send("/v1/technologies", "POST", json(technology, auth));

    expect(response.status).toBe(201);
    expect((await send("/v1/technologies/postgres", "GET")).status).toBe(200);
    await invalidation.idle();
    expect(website.deliveries).toHaveLength(3);
  });

  it("keeps a committed write when the notifier throws or rejects, and logs only metadata", async () => {
    const detail = "fictional notifier detail with a headline";
    for (const failing of [
      () => {
        throw new Error(detail);
      },
      () => Promise.reject(new TypeError(detail)),
    ]) {
      const lines: string[] = [];
      const { app } = backend.api({ onWrite: failing, log: (line) => lines.push(line) });

      const created = await app.request(
        "/v1/technologies",
        { method: "POST", ...json(technology, auth) },
        connection(),
      );

      expect(created.status).toBe(201);
      expect((await send("/v1/technologies/postgres", "GET")).status).toBe(200);
      const notifying = lines.filter((line) => line.startsWith("error notifying"));
      expect(notifying).toHaveLength(1);
      expect(notifying[0]).toMatch(/^error notifying POST \/v1\/technologies: (Type)?Error$/u);
      expect(lines.join("\n")).not.toContain(detail);
      await backend.services.profile.deleteTechnology("postgres");
    }
  });

  it("sends nothing when the write's transaction fails", async () => {
    const failure = new Error("fictional failed transaction");
    const services = new Proxy(backend.services, {
      get(target, property, receiver) {
        const value: unknown = Reflect.get(target, property, receiver);
        if (property !== "profile") return value;
        return new Proxy(target.profile, {
          get(profile, name) {
            if (name === "createTechnology") return () => Promise.reject(failure);
            const method: unknown = Reflect.get(profile, name);
            return typeof method === "function"
              ? (...args: unknown[]): unknown => Reflect.apply(method, profile, args)
              : method;
          },
        });
      },
    });
    const { app: failing } = createApp({
      services,
      config: testConfig(),
      log: () => undefined,
      onWrite: invalidation.notify,
    });

    const response = await failing.request(
      "/v1/technologies",
      { method: "POST", ...json(technology, auth) },
      connection(),
    );

    expect(response.status).toBe(500);
    expect(await delivered()).toEqual([]);
  });
});
