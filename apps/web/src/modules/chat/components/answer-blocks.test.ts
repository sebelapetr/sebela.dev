import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatBlockSchema, type ChatBlock, type ChatSource } from "@sebela/contracts";

import { AnswerBlock, AnswerSources } from "./answer-blocks";

function render(block: ChatBlock): string {
  return renderToStaticMarkup(createElement(AnswerBlock, { block }));
}

const experienceCard: ChatBlock = {
  type: "ExperienceCard",
  title: "Lead engineer",
  organization: "Fictional Freight",
  startedOn: "2022-03-01",
  endedOn: null,
  summary: "Leads a fictional team.",
  technologies: ["TypeScript", "Postgres"],
  href: "/experience#experience-lead-engineer",
};

/** The reserved roadmap card's fixture: a contract shape only, no roadmap record of phase 4. */
const roadmapCard: ChatBlock = {
  type: "RoadmapCard",
  title: "Fictional roadmap item",
  summary: "A made-up step for the renderer's test.",
  href: "/ai-roadmap",
};

describe("AnswerBlock", () => {
  it("shows an experience with its period, organization, summary and technologies, leading to it", () => {
    const html = render(experienceCard);
    expect(html).toContain('href="/experience#experience-lead-engineer"');
    expect(html).toContain("Lead engineer");
    expect(html).toContain("Fictional Freight");
    expect(html).toContain("March 1st, 2022 – present");
    expect(html).toContain("Leads a fictional team.");
    expect(html).toContain("TypeScript");
  });

  it("shows a service with its summary, leading to it", () => {
    const html = render({
      type: "ServiceCard",
      title: "Process automation",
      summary: "Automates a fictional process.",
      href: "/services#service-process-automation",
    });
    expect(html).toContain('href="/services#service-process-automation"');
    expect(html).toContain("Process automation");
    expect(html).toContain("Automates a fictional process.");
  });

  it.each([
    ["built", "Built", "Implemented and working"],
    ["tested", "Tested", "Tried hands-on"],
    ["designed", "Designed", "Unimplemented design, planned or architected only"],
  ] as const)("shows an exploration's stored status %s in full words", (status, label, meaning) => {
    const html = render({
      type: "ExplorationCard",
      title: "Tool scopes",
      summary: null,
      status,
      href: "/experience#exploration-tool-scopes",
    });
    expect(html).toContain(label);
    expect(html).toContain(meaning);
    expect(html).toContain('href="/experience#exploration-tool-scopes"');
  });

  it("shows the contact: the email as a mail link and the web links", () => {
    const html = render({
      type: "ContactCard",
      email: "casey+work@morrow.example.test",
      links: [{ label: "Code", url: "https://code.example.test/casey" }],
    });
    expect(html).toContain('href="mailto:casey%2Bwork@morrow.example.test"');
    expect(html).toContain("casey+work@morrow.example.test");
    expect(html).toContain('href="https://code.example.test/casey"');
    expect(html).toContain("Code");
  });

  it("renders the reserved roadmap card from its contract fixture", () => {
    expect(ChatBlockSchema.parse(roadmapCard)).toEqual(roadmapCard);
    const html = render(roadmapCard);
    expect(html).toContain("AI Roadmap");
    expect(html).toContain("Fictional roadmap item");
    expect(html).toContain('href="/ai-roadmap"');
  });

  it("escapes markup in a block's text, never rendering it as HTML", () => {
    const html = render({
      ...experienceCard,
      title: "<script>alert(1)</script>",
      summary: '<img src="x" onerror="alert(1)">',
      technologies: ["<b>bold</b>"],
    });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it.each([
    ["a script address", { ...experienceCard, href: "javascript:alert(1)" }],
    ["another host", { ...experienceCard, href: "//evil.example.test" }],
    ["an unknown type", { ...experienceCard, type: "HtmlCard" }],
    ["a missing field", { ...experienceCard, title: undefined }],
    [
      "a contact link with a script address",
      { type: "ContactCard", email: null, links: [{ label: "X", url: "javascript:alert(1)" }] },
    ],
  ])("renders nothing for a block with %s, whatever reached it", (_label, block) => {
    expect(render(block as unknown as ChatBlock)).toBe("");
  });
});

describe("AnswerSources", () => {
  const experienceSource: ChatSource = {
    record: { kind: "experience", id: "lead-engineer" },
    title: "Lead engineer, Fictional Freight",
    href: "/experience#experience-lead-engineer",
  };
  const projectSource: ChatSource = {
    record: { kind: "project", id: "route-planner" },
    title: "Route planner: technical case study",
    href: "/experience#case-study-route-planner",
  };
  const sources = [experienceSource, projectSource];

  function renderSources(list: readonly ChatSource[]): string {
    return renderToStaticMarkup(createElement(AnswerSources, { sources: list }));
  }

  it("lists each source in order, leading to its exact place on the site", () => {
    const html = renderSources(sources);
    expect(html).toContain("Sources");
    expect(html).toContain("<ol");
    expect(html.indexOf('href="/experience#experience-lead-engineer"')).toBeLessThan(
      html.indexOf('href="/experience#case-study-route-planner"'),
    );
    expect(html).toContain("Route planner: technical case study");
  });

  it("renders nothing without sources, never an empty Sources block", () => {
    expect(renderSources([])).toBe("");
  });

  it("leaves out a source that does not validate", () => {
    const html = renderSources([
      { ...experienceSource, href: "javascript:alert(1)" },
      projectSource,
    ]);
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="/experience#case-study-route-planner"');
  });
});
