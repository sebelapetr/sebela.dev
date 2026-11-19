import { describe, expect, it } from "vitest";

import type {
  CurrentFocus,
  Exploration,
  RoadmapCurrentArea,
  RoadmapCurrentModule,
  Topic,
} from "@sebela/api-client";

import { toNow } from "./now";

const STAMP = "2026-01-01T00:00:00.000Z";

function topic(slug: string, name: string): Topic {
  return {
    id: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e61",
    slug,
    name,
    position: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

/** A fictional current focus as the public list returns it. */
function focus(overrides: Partial<CurrentFocus> = {}): CurrentFocus {
  return {
    id: "9f4a6b8c-0d2e-4f5a-9b3c-4d6e8f0a2b54",
    slug: "fictional-focus",
    title: "A fictional focus",
    description: "Something **made up** for tests.",
    link: null,
    position: 0,
    project: null,
    topics: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

/** A fictional exploration as the public list returns it; ongoing unless it says otherwise. */
function exploration(overrides: Partial<Exploration> = {}): Exploration {
  return {
    id: "0a5b7c9d-1e3f-4a6b-8c4d-5e7f9a1b3c65",
    slug: "fictional-exploration",
    name: "Fictional exploration",
    summary: "A made-up experiment.",
    status: "tested",
    concepts: [],
    startedOn: "2026-02-01",
    endedOn: null,
    position: 0,
    technologies: [],
    topics: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

type Progress = Pick<RoadmapCurrentArea["progress"], "completed" | "total">;

function currentProgress({ completed, total }: Progress): RoadmapCurrentArea["progress"] {
  return {
    completed,
    total,
    status: "in-progress",
    completedAt: null,
    lastUpdatedAt: STAMP,
    estimatedMinutes: 0,
  };
}

/** A fictional module in progress, as the roadmap's current learning returns it. */
function currentModule(slug: string, name: string, progress: Progress): RoadmapCurrentModule {
  return {
    id: "4d5e6f7a-8b9c-4d0e-8f1a-2b3c4d5e6f70",
    slug,
    name,
    description: null,
    position: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    progress: currentProgress(progress),
  };
}

/** A fictional area in progress, as the roadmap's current learning returns it. */
function currentArea(
  slug: string,
  name: string,
  progress: Progress,
  modules: RoadmapCurrentModule[],
): RoadmapCurrentArea {
  return {
    id: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a81",
    slug,
    name,
    description: null,
    weight: 10,
    position: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    progress: currentProgress(progress),
    modules,
  };
}

describe("toNow", () => {
  describe("Working on", () => {
    it("shows every current focus in the API's order, with its topics' names", () => {
      const now = toNow(
        [
          focus({
            slug: "first",
            title: "First focus",
            topics: [topic("evals", "Evals"), topic("retrieval", "Retrieval")],
          }),
          focus({ slug: "second", title: "Second focus" }),
        ],
        [],
        [],
      );

      expect(now?.workingOn).toEqual([
        {
          slug: "first",
          title: "First focus",
          description: "Something **made up** for tests.",
          topics: ["Evals", "Retrieval"],
          link: null,
        },
        {
          slug: "second",
          title: "Second focus",
          description: "Something **made up** for tests.",
          topics: [],
          link: null,
        },
      ]);
    });

    it("links a focus about a project to that project on the experience page", () => {
      const now = toNow(
        [
          focus({
            project: { slug: "route-planner", name: "Route planner", experience: "fernway" },
            link: "https://elsewhere.example.test/",
          }),
        ],
        [],
        [],
      );

      expect(now?.workingOn[0]?.link).toEqual({
        href: "/experience#project-route-planner",
        label: "View the project",
        external: false,
      });
    });

    it("links a focus without a project to its own web link", () => {
      const now = toNow([focus({ link: "https://notes.example.test/focus" })], [], []);

      expect(now?.workingOn[0]?.link).toEqual({
        href: "https://notes.example.test/focus",
        label: "Read more",
        external: true,
      });
    });

    it("never links to an address that is not on the web", () => {
      const now = toNow([focus({ link: "javascript:alert(1)" })], [], []);

      expect(now?.workingOn[0]?.link).toBeNull();
    });
  });

  describe("Exploring", () => {
    it("shows the roadmap's areas in progress, each linking to its page with its modules in progress", () => {
      const now = toNow(
        [],
        [],
        [
          currentArea("signal-area", "Signal area", { completed: 1, total: 4 }, [
            currentModule("signal-basics", "Signal basics", { completed: 1, total: 2 }),
            currentModule("signal-depth", "Signal depth", { completed: 0, total: 1 }),
          ]),
          currentArea("queue-area", "Queue area", { completed: 0, total: 3 }, [
            currentModule("calm-queues", "Calm queues", { completed: 0, total: 3 }),
          ]),
        ],
      );

      expect(now?.exploring).toEqual([
        {
          slug: "signal-area",
          name: "Signal area",
          href: "/ai-roadmap/signal-area",
          progress: "1/4",
          modules: [
            {
              slug: "signal-basics",
              name: "Signal basics",
              href: "/ai-roadmap/signal-area/signal-basics",
              progress: "1/2",
            },
            {
              slug: "signal-depth",
              name: "Signal depth",
              href: "/ai-roadmap/signal-area/signal-depth",
              progress: "0/1",
            },
          ],
        },
        {
          slug: "queue-area",
          name: "Queue area",
          href: "/ai-roadmap/queue-area",
          progress: "0/3",
          modules: [
            {
              slug: "calm-queues",
              name: "Calm queues",
              href: "/ai-roadmap/queue-area/calm-queues",
              progress: "0/3",
            },
          ],
        },
      ]);
    });

    it("no longer shows ongoing explorations, which stay on the experience page", () => {
      const now = toNow([focus()], [exploration({ slug: "ongoing" })], []);

      expect(now?.exploring).toEqual([]);
    });

    it("keeps each slug inside its own address segment", () => {
      const now = toNow(
        [],
        [],
        [
          currentArea("a/b", "Odd area", { completed: 0, total: 1 }, [
            currentModule("c?d", "Odd module", { completed: 0, total: 1 }),
          ]),
        ],
      );

      expect(now?.exploring[0]?.href).toBe("/ai-roadmap/a%2Fb");
      expect(now?.exploring[0]?.modules[0]?.href).toBe("/ai-roadmap/a%2Fb/c%3Fd");
    });
  });

  describe("the links", () => {
    it("lead to the independent R&D block and to the AI Roadmap", () => {
      const now = toNow([focus()], [exploration()], []);

      expect(now?.independentRdHref).toBe("/experience#independent-rd");
      expect(now?.roadmapHref).toBe("/ai-roadmap");
    });

    it("lead to the independent R&D block while only finished explorations remain", () => {
      const now = toNow([focus()], [exploration({ endedOn: "2026-03-01" })], []);

      expect(now?.exploring).toEqual([]);
      expect(now?.independentRdHref).toBe("/experience#independent-rd");
    });

    it("leave the independent R&D block out without any exploration, for it is not on the page", () => {
      const now = toNow([focus()], [], []);

      expect(now?.independentRdHref).toBeNull();
      expect(now?.roadmapHref).toBe("/ai-roadmap");
    });
  });

  it("is absent with nothing being built and nothing in progress on the roadmap", () => {
    expect(toNow([], [], [])).toBeNull();
    expect(toNow([], [exploration()], [])).toBeNull();
  });
});
