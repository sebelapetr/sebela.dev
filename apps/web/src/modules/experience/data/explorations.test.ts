import { describe, expect, it } from "vitest";

import type { Exploration, ExplorationStatus } from "@sebela/api-client";

import { toExplorationRows } from "./explorations";

const STAMP = "2026-01-01T00:00:00.000Z";

function exploration(
  slug: string,
  status: ExplorationStatus,
  overrides: Partial<Exploration> = {},
): Exploration {
  return {
    id: "8b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
    slug,
    name: `Fictional ${slug}`,
    summary: "A made-up experiment for the tests.",
    status,
    concepts: [],
    startedOn: "2025-02-01",
    endedOn: null,
    position: 0,
    technologies: [],
    topics: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

describe("toExplorationRows", () => {
  it("keeps the API's order and addresses each row by its slug", () => {
    const rows = toExplorationRows([
      exploration("local-agent", "tested"),
      exploration("eval-harness", "built"),
      exploration("memory-graph", "designed"),
    ]);

    expect(rows.map((row) => [row.slug, row.anchor])).toEqual([
      ["local-agent", "exploration-local-agent"],
      ["eval-harness", "exploration-eval-harness"],
      ["memory-graph", "exploration-memory-graph"],
    ]);
  });

  it("shows each stored status as visible text with its meaning", () => {
    const rows = toExplorationRows([
      exploration("a", "built"),
      exploration("b", "tested"),
      exploration("c", "designed"),
    ]);

    expect(rows.map((row) => [row.status, row.statusLabel, row.statusMeaning])).toEqual([
      ["built", "Built", "Implemented and working"],
      ["tested", "Tested", "Tried hands-on"],
      ["designed", "Designed", "Unimplemented design, planned or architected only"],
    ]);
  });

  it("never presents a designed exploration as built, tried or delivered", () => {
    const [row] = toExplorationRows([exploration("c", "designed")]);

    expect(row?.statusLabel).toBe("Designed");
    expect(row?.statusMeaning).toMatch(/^Unimplemented/);
    expect(row?.statusMeaning).not.toMatch(/working|hands-on|production|client|delivered/i);
  });

  it("keeps the name, the summary and the concepts in their stored order", () => {
    const [row] = toExplorationRows([
      exploration("local-agent", "built", {
        name: "Local agent",
        summary: "An agent that runs **offline**.",
        concepts: ["tool calling", "RAG", "evals"],
      }),
    ]);

    expect(row).toMatchObject({
      name: "Local agent",
      summary: "An agent that runs **offline**.",
      concepts: ["tool calling", "RAG", "evals"],
    });
  });

  it("is empty without explorations", () => {
    expect(toExplorationRows([])).toEqual([]);
  });
});
