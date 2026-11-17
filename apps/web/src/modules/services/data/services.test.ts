import { describe, expect, it } from "vitest";

import type { Service, ServiceEvidence } from "@sebela/api-client";

import { toCollaborationSteps, toServiceRows } from "./services";

const STAMP = "2026-01-01T00:00:00.000Z";

function service(slug: string, evidence: ServiceEvidence[] = []): Service {
  return {
    id: "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f",
    slug,
    name: `Fictional ${slug}`,
    summary: "A made-up offer for the tests.",
    audience: "Fictional firms.",
    deliverable: "A fictional result.",
    position: 0,
    evidence,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

const project = (slug: string): ServiceEvidence => ({
  kind: "project",
  project: { slug, name: `Project ${slug}`, summary: "Made up.", experience: "some-role" },
});

const exploration = (slug: string, status: "built" | "tested" | "designed"): ServiceEvidence => ({
  kind: "exploration",
  exploration: { slug, name: `Exploration ${slug}`, summary: "Made up.", status },
});

const link = (label: string, path: string): ServiceEvidence => ({ kind: "link", label, path });

describe("toServiceRows", () => {
  it("keeps the API's order, numbers the rows and gives each its stable anchor", () => {
    const rows = toServiceRows([service("automation"), service("software"), service("ai")]);

    expect(rows.map((row) => [row.number, row.slug, row.anchor])).toEqual([
      ["01", "automation", "service-automation"],
      ["02", "software", "service-software"],
      ["03", "ai", "service-ai"],
    ]);
    expect(rows[0]).toMatchObject({
      name: "Fictional automation",
      summary: "A made-up offer for the tests.",
      audience: "Fictional firms.",
      deliverable: "A fictional result.",
    });
  });

  it("links a project to its exact anchor on the experience page", () => {
    const [row] = toServiceRows([service("a", [project("route-planner")])]);

    expect(row?.evidence).toEqual([
      {
        kind: "project",
        key: "project:route-planner",
        name: "Project route-planner",
        href: "/experience#project-route-planner",
      },
    ]);
  });

  it("links an exploration as independent R&D with its stored status as text", () => {
    const [row] = toServiceRows([
      service("a", [exploration("answer-checker", "built"), exploration("chunks", "tested")]),
    ]);

    expect(row?.evidence).toEqual([
      {
        kind: "exploration",
        key: "exploration:answer-checker",
        name: "Exploration answer-checker",
        href: "/experience#exploration-answer-checker",
        statusLabel: "Built",
        statusMeaning: "Implemented and working",
      },
      {
        kind: "exploration",
        key: "exploration:chunks",
        name: "Exploration chunks",
        href: "/experience#exploration-chunks",
        statusLabel: "Tested",
        statusMeaning: "Tried hands-on",
      },
    ]);
  });

  it("never counts a designed exploration as evidence, only as planned work", () => {
    const [row] = toServiceRows([
      service("a", [project("p"), exploration("tool-scopes", "designed")]),
    ]);

    expect(row?.evidence.map((item) => item.key)).toEqual(["project:p"]);
    expect(row?.planned).toEqual([
      {
        kind: "exploration",
        key: "exploration:tool-scopes",
        name: "Exploration tool-scopes",
        href: "/experience#exploration-tool-scopes",
        statusLabel: "Designed",
        statusMeaning: "Unimplemented design, planned or architected only",
      },
    ]);
  });

  it("keeps a site link to one of the site's pages exactly as stored", () => {
    const [row] = toServiceRows([
      service("a", [
        link("Independent R&D", "/experience#independent-rd"),
        link("Contact", "/#contact"),
        link("Experience", "/experience"),
      ]),
    ]);

    expect(row?.evidence).toEqual([
      {
        kind: "link",
        key: "link:/experience#independent-rd",
        label: "Independent R&D",
        href: "/experience#independent-rd",
      },
      { kind: "link", key: "link:/#contact", label: "Contact", href: "/#contact" },
      { kind: "link", key: "link:/experience", label: "Experience", href: "/experience" },
    ]);
  });

  it("leaves out a site link to a page the site does not have, never a dead link", () => {
    const [row] = toServiceRows([
      service("a", [
        link("Projects", "/projects"),
        link("Roadmap", "/roadmap?tab=ai"),
        link("Nested", "/experience/older"),
        project("p"),
      ]),
    ]);

    expect(row?.evidence.map((item) => item.key)).toEqual(["project:p"]);
  });

  it("has no evidence and nothing planned for a service without evidence", () => {
    const [row] = toServiceRows([service("a")]);

    expect(row?.evidence).toEqual([]);
    expect(row?.planned).toEqual([]);
  });

  it("is empty without services", () => {
    expect(toServiceRows([])).toEqual([]);
  });
});

describe("toCollaborationSteps", () => {
  it("numbers the steps in their stored order", () => {
    expect(
      toCollaborationSteps([
        { title: "Understand", description: "A short **call**." },
        { title: "Build", description: "In small steps." },
      ]),
    ).toEqual([
      { number: "01", title: "Understand", description: "A short **call**." },
      { number: "02", title: "Build", description: "In small steps." },
    ]);
  });

  it("is empty without steps", () => {
    expect(toCollaborationSteps([])).toEqual([]);
  });
});
