import { describe, expect, it } from "vitest";

import {
  DiaryEventSchema,
  RoadmapEventCreateSchema,
  RoadmapEventListSchema,
  RoadmapEventSchema,
  RoadmapEventUpdateSchema,
  roadmapEventKinds,
} from "./index.js";

/** A fictional multi-day event with every writable field. */
const summit = {
  slug: "fictional-ai-summit",
  name: "Fictional AI Summit",
  kind: "conference",
  organizer: "Example Community",
  startsOn: "2026-03-02",
  endsOn: "2026-03-04",
  place: "Example Hall, Brno",
  online: false,
  link: "https://example.com/summit",
  takeaways: "## Takeaways\n\nA **fictional** note.",
  topics: ["agents"],
};

const stored = {
  id: "8a7b6c5d-4e3f-4a1b-9c2d-1e0f9a8b7c6d",
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-02T10:00:00.000Z",
};

const topic = {
  ...stored,
  id: "1f2e3d4c-5b6a-4987-8a6b-5c4d3e2f1a0b",
  slug: "agents",
  name: "Agents",
  position: 0,
};

const event = { ...stored, ...summit, topics: [topic], attendanceSeconds: 5400 };

describe("roadmapEventKinds", () => {
  it("names the four kinds of event", () => {
    expect(roadmapEventKinds).toEqual(["conference", "meetup", "workshop", "lecture"]);
  });
});

describe("RoadmapEventSchema", () => {
  it("describes an event with its topics and derived attendance time", () => {
    expect(RoadmapEventSchema.parse(event)).toEqual(event);
    expect(RoadmapEventListSchema.parse([event])).toEqual([event]);
  });

  it("allows a single-day online event without optional fields", () => {
    const bare = {
      ...event,
      organizer: null,
      startsOn: "2026-03-02",
      endsOn: "2026-03-02",
      place: null,
      online: true,
      link: null,
      takeaways: null,
      topics: [],
      attendanceSeconds: 0,
    };
    expect(RoadmapEventSchema.parse(bare)).toEqual(bare);
  });

  it("refuses an unknown kind and negative attendance", () => {
    expect(RoadmapEventSchema.safeParse({ ...event, kind: "party" }).success).toBe(false);
    expect(RoadmapEventSchema.safeParse({ ...event, attendanceSeconds: -1 }).success).toBe(false);
  });
});

describe("DiaryEventSchema", () => {
  it("describes the event a diary day shows", () => {
    const shown = {
      slug: summit.slug,
      name: summit.name,
      kind: summit.kind,
      startsOn: summit.startsOn,
      endsOn: summit.endsOn,
      link: summit.link,
    };
    expect(DiaryEventSchema.parse(shown)).toEqual(shown);
  });
});

describe("RoadmapEventCreateSchema", () => {
  it("accepts an event with every field", () => {
    expect(RoadmapEventCreateSchema.parse(summit)).toEqual(summit);
  });

  it("fills omitted optional fields with none, in person and without topics", () => {
    const required = {
      slug: "fictional-meetup",
      name: "Fictional Meetup",
      kind: "meetup",
      startsOn: "2026-04-01",
      endsOn: "2026-04-01",
    };
    expect(RoadmapEventCreateSchema.parse(required)).toEqual({
      ...required,
      organizer: null,
      place: null,
      online: false,
      link: null,
      takeaways: null,
      topics: [],
    });
  });

  it("accepts a single-day event and refuses an end before the start", () => {
    expect(RoadmapEventCreateSchema.safeParse({ ...summit, endsOn: summit.startsOn }).success).toBe(
      true,
    );
    const result = RoadmapEventCreateSchema.safeParse({ ...summit, endsOn: "2026-03-01" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["endsOn"]);
  });

  it("refuses a topic listed twice", () => {
    const result = RoadmapEventCreateSchema.safeParse({ ...summit, topics: ["agents", "agents"] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["topics"]);
  });

  it.each([
    ["kind", "party"],
    ["startsOn", "2026-02-30"],
    ["endsOn", "2026-03-04T00:00:00Z"],
    ["name", "  "],
    ["slug", "Fictional Summit"],
    ["link", "javascript:alert(1)"],
    ["online", "yes"],
  ])("refuses an invalid %s", (field, value) => {
    const result = RoadmapEventCreateSchema.safeParse({ ...summit, [field]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });

  it("refuses missing dates and derived or unknown fields", () => {
    const withoutStart: Partial<typeof summit> = { ...summit };
    delete withoutStart.startsOn;
    expect(RoadmapEventCreateSchema.safeParse(withoutStart).success).toBe(false);
    expect(RoadmapEventCreateSchema.safeParse({ ...summit, attendanceSeconds: 60 }).success).toBe(
      false,
    );
    expect(RoadmapEventCreateSchema.safeParse({ ...summit, module: "x" }).success).toBe(false);
  });
});

describe("RoadmapEventUpdateSchema", () => {
  it("changes only the sent fields, clears with null and checks dates sent together", () => {
    expect(RoadmapEventUpdateSchema.parse({ takeaways: null })).toEqual({ takeaways: null });
    expect(RoadmapEventUpdateSchema.parse({ endsOn: "2026-03-05" })).toEqual({
      endsOn: "2026-03-05",
    });
    const reversed = RoadmapEventUpdateSchema.safeParse({
      startsOn: "2026-03-05",
      endsOn: "2026-03-04",
    });
    expect(reversed.error?.issues[0]?.path).toEqual(["endsOn"]);
  });

  it("refuses an empty body, a slug change and clearing a required field", () => {
    expect(RoadmapEventUpdateSchema.safeParse({}).success).toBe(false);
    expect(RoadmapEventUpdateSchema.safeParse({ slug: "other" }).success).toBe(false);
    expect(RoadmapEventUpdateSchema.safeParse({ startsOn: null }).success).toBe(false);
  });
});
