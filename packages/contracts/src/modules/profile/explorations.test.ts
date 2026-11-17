import { describe, expect, it } from "vitest";

import {
  ExplorationCreateSchema,
  ExplorationListSchema,
  ExplorationSchema,
  ExplorationUpdateSchema,
  explorationStatuses,
} from "./index.js";

const stored = {
  id: "3c9e1f7a-5b2d-4e8a-9f1c-7d6b5a4e3c2b",
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-02T10:00:00.000Z",
};

const agentLab = {
  slug: "agent-lab",
  name: "Agent lab",
  summary: "A **fictional** playground for tool-calling agents.",
  status: "tested",
  concepts: ["Tool calling", "Evaluation loops"],
  startedOn: "2025-02-01",
  endedOn: "2025-06-30",
  position: 2,
  technologies: ["typescript", "postgres"],
  topics: ["agents", "rag"],
};

const technology = {
  ...stored,
  slug: "typescript",
  name: "TypeScript",
  tier: "primary",
  group: "core",
  logoKey: null,
  position: 1,
};

const topic = { ...stored, slug: "agents", name: "Agents", position: 0 };

describe("explorationStatuses", () => {
  it("lists built, tested and designed, from the strongest claim to the weakest", () => {
    expect(explorationStatuses).toEqual(["built", "tested", "designed"]);
  });
});

describe("ExplorationCreateSchema", () => {
  it("accepts an exploration with every field", () => {
    expect(ExplorationCreateSchema.parse(agentLab)).toEqual(agentLab);
  });

  it.each(explorationStatuses)("keeps the status %s exactly as sent", (status) => {
    expect(ExplorationCreateSchema.parse({ ...agentLab, status })).toMatchObject({ status });
  });

  it("accepts an open end and an end on the day of the start", () => {
    expect(ExplorationCreateSchema.parse({ ...agentLab, endedOn: null })).toMatchObject({
      endedOn: null,
    });
    const sameDay = { ...agentLab, startedOn: "2025-01-01", endedOn: "2025-01-01" };
    expect(ExplorationCreateSchema.parse(sameDay)).toMatchObject({ endedOn: "2025-01-01" });
  });

  it("fills an unset end, concepts, technologies and topics", () => {
    const minimal = {
      slug: "vector-notes",
      name: "Vector notes",
      summary: "A design for searchable notes.",
      status: "designed",
      startedOn: "2025-03-01",
      position: 0,
    };
    expect(ExplorationCreateSchema.parse(minimal)).toEqual({
      ...minimal,
      endedOn: null,
      concepts: [],
      technologies: [],
      topics: [],
    });
  });

  it("keeps the concepts in their order and trims each of them", () => {
    expect(
      ExplorationCreateSchema.parse({ ...agentLab, concepts: [" Zeta ", "Alpha", "Mu"] }),
    ).toMatchObject({ concepts: ["Zeta", "Alpha", "Mu"] });
  });

  it("trims the name and the summary", () => {
    expect(
      ExplorationCreateSchema.parse({ ...agentLab, name: " Lab ", summary: " x " }),
    ).toMatchObject({ name: "Lab", summary: "x" });
  });

  it.each([
    ["a missing slug", { ...agentLab, slug: undefined }],
    ["an invalid slug", { ...agentLab, slug: "Agent Lab" }],
    ["a missing name", { ...agentLab, name: undefined }],
    ["an empty name", { ...agentLab, name: " " }],
    ["a name that is too long", { ...agentLab, name: "x".repeat(201) }],
    ["a missing summary", { ...agentLab, summary: undefined }],
    ["a summary that is too long", { ...agentLab, summary: "x".repeat(5001) }],
    ["a missing status", { ...agentLab, status: undefined }],
    ["an unknown status", { ...agentLab, status: "released" }],
    ["a status in another case", { ...agentLab, status: "Built" }],
    ["a status that is not text", { ...agentLab, status: 1 }],
    ["an empty concept", { ...agentLab, concepts: [" "] }],
    ["a concept that is too long", { ...agentLab, concepts: ["x".repeat(201)] }],
    ["too many concepts", { ...agentLab, concepts: Array(31).fill("x") }],
    ["concepts that are not a list", { ...agentLab, concepts: "Tool calling" }],
    ["a missing start", { ...agentLab, startedOn: undefined }],
    ["a start that is not a date", { ...agentLab, startedOn: "February 2025" }],
    ["an impossible date", { ...agentLab, startedOn: "2025-02-30" }],
    ["an end before the start", { ...agentLab, startedOn: "2025-01-02", endedOn: "2025-01-01" }],
    ["a missing position", { ...agentLab, position: undefined }],
    ["a negative position", { ...agentLab, position: -1 }],
    ["a fractional position", { ...agentLab, position: 1.5 }],
    ["a technology that is not a slug", { ...agentLab, technologies: ["Type Script"] }],
    ["an embedded technology", { ...agentLab, technologies: [{ slug: "typescript" }] }],
    ["a repeated technology", { ...agentLab, technologies: ["postgres", "postgres"] }],
    [
      "too many technologies",
      { ...agentLab, technologies: [...Array(51).keys()].map((n) => `t${String(n)}`) },
    ],
    ["a topic that is not a slug", { ...agentLab, topics: ["Agents!"] }],
    ["an embedded topic", { ...agentLab, topics: [{ slug: "agents" }] }],
    ["a repeated topic", { ...agentLab, topics: ["rag", "rag"] }],
    ["too many topics", { ...agentLab, topics: [...Array(51).keys()].map((n) => `t${String(n)}`) }],
    ["an experience, which an exploration never belongs to", { ...agentLab, experience: "lead" }],
    ["a visibility flag", { ...agentLab, visible: true }],
    ["a CV flag", { ...agentLab, inCv: true }],
  ])("rejects %s", (_, input) => {
    expect(ExplorationCreateSchema.safeParse(input).success).toBe(false);
  });

  it("names the end when it is before the start", () => {
    const result = ExplorationCreateSchema.safeParse({ ...agentLab, endedOn: "2020-01-01" });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["endedOn"]]);
  });

  it("names the status when it is unknown", () => {
    const result = ExplorationCreateSchema.safeParse({ ...agentLab, status: "shipped" });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["status"]]);
  });

  it("names the technologies and the topics when one is repeated", () => {
    const technologies = ExplorationCreateSchema.safeParse({
      ...agentLab,
      technologies: ["typescript", "typescript"],
    });
    expect(technologies.error?.issues.map((issue) => issue.path)).toEqual([["technologies"]]);
    const topics = ExplorationCreateSchema.safeParse({ ...agentLab, topics: ["rag", "rag"] });
    expect(topics.error?.issues.map((issue) => issue.path)).toEqual([["topics"]]);
  });
});

describe("ExplorationUpdateSchema", () => {
  it("accepts a partial change without filling other fields", () => {
    expect(ExplorationUpdateSchema.parse({ status: "built" })).toEqual({ status: "built" });
  });

  it("keeps the concepts and relations unchanged when they are omitted", () => {
    const parsed = ExplorationUpdateSchema.parse({ name: "Renamed" });
    expect(parsed).not.toHaveProperty("concepts");
    expect(parsed).not.toHaveProperty("technologies");
    expect(parsed).not.toHaveProperty("topics");
  });

  it("accepts replacing the concepts, technologies and topics, including with empty lists", () => {
    expect(
      ExplorationUpdateSchema.parse({ concepts: ["Retrieval"], technologies: [], topics: ["mcp"] }),
    ).toEqual({ concepts: ["Retrieval"], technologies: [], topics: ["mcp"] });
  });

  it("accepts reopening the end", () => {
    expect(ExplorationUpdateSchema.parse({ endedOn: null })).toEqual({ endedOn: null });
  });

  it.each([
    ["an empty change", {}],
    ["a change of the slug", { slug: "renamed" }],
    ["clearing the status", { status: null }],
    ["an unknown status", { status: "delivered" }],
    ["clearing the start", { startedOn: null }],
    ["clearing the concepts", { concepts: null }],
    ["clearing the topics", { topics: null }],
    ["an end before the start", { startedOn: "2025-01-02", endedOn: "2025-01-01" }],
    ["a repeated topic", { topics: ["mcp", "mcp"] }],
    ["a repeated technology", { technologies: ["postgres", "postgres"] }],
    ["an experience", { experience: "lead" }],
  ])("rejects %s", (_, input) => {
    expect(ExplorationUpdateSchema.safeParse(input).success).toBe(false);
  });
});

describe("ExplorationSchema and ExplorationListSchema", () => {
  it("describe stored explorations with their technologies and topics resolved", () => {
    const exploration = { ...stored, ...agentLab, technologies: [technology], topics: [topic] };
    expect(ExplorationSchema.parse(exploration)).toEqual(exploration);
    expect(ExplorationListSchema.parse([exploration])).toEqual([exploration]);
    expect(ExplorationListSchema.parse([])).toEqual([]);
  });

  it.each(explorationStatuses)("return the status %s exactly as stored", (status) => {
    const exploration = { ...stored, ...agentLab, status, technologies: [], topics: [] };
    expect(ExplorationSchema.parse(exploration)).toMatchObject({ status });
  });

  it("rejects relations given only by their slugs", () => {
    expect(ExplorationSchema.safeParse({ ...stored, ...agentLab }).success).toBe(false);
  });

  it("rejects a stored status outside the defined ones", () => {
    const exploration = { ...stored, ...agentLab, status: "shipped", technologies: [], topics: [] };
    expect(ExplorationSchema.safeParse(exploration).success).toBe(false);
  });
});
