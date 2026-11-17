import { describe, expect, it } from "vitest";

import {
  ChatBlockSchema,
  ChatRelatedLinkSchema,
  ChatSourcesSchema,
  type ChatBlock,
} from "@sebela/contracts";

import { anchorHref } from "../../_shared";
import type { AskEvidence } from "./evidence";
import { askSuggestions, heroSuggestions, preparedAnswer } from "./prepared-answers";

const NAME = "Casey Morrow";

const HIRING = `Would ${NAME} fit an AI engineering role?`;
const CLIENTS = `What could ${NAME} automate for my company?`;
const TECHNICAL = `What are ${NAME}'s strongest engineering skills?`;
const GENERAL = `What is ${NAME} working on now?`;
const UNKNOWN = "What is the capital of a fictional country?";

function evidence(overrides: Partial<AskEvidence> = {}): AskEvidence {
  return {
    name: NAME,
    contact: {
      email: "casey@morrow.example.test",
      links: [{ label: "Code", url: "https://code.example.test/casey" }],
    },
    experiences: [
      {
        slug: "lead-engineer",
        title: "Lead engineer",
        organization: "Fictional Freight",
        startedOn: "2022-03-01",
        endedOn: null,
        summary: "Leads a fictional team.",
        technologies: ["TypeScript", "Postgres"],
        projects: [
          { slug: "route-planner", name: "Route planner", caseStudy: true },
          { slug: "export-tool", name: "Export tool", caseStudy: false },
        ],
      },
      {
        slug: "senior-developer",
        title: "Senior developer",
        organization: "Fictional Clinic",
        startedOn: "2018-01-01",
        endedOn: "2022-02-28",
        summary: null,
        technologies: [],
        projects: [{ slug: "clinic-scheduling", name: "Clinic scheduling", caseStudy: true }],
      },
      {
        slug: "developer",
        title: "Developer",
        organization: "Fictional Clinic",
        startedOn: "2015-01-01",
        endedOn: "2017-12-31",
        summary: null,
        technologies: [],
        projects: [{ slug: "old-portal", name: "Old portal", caseStudy: true }],
      },
    ],
    services: [
      { slug: "process-automation", name: "Process automation", summary: "Automates." },
      { slug: "custom-software", name: "Custom software", summary: "Builds." },
      { slug: "ai-integration", name: "AI integration", summary: "Integrates." },
    ],
    explorations: [
      { slug: "answer-checker", name: "Answer checker", summary: "Checks.", status: "built" },
      { slug: "chunk-comparison", name: "Chunk comparison", summary: null, status: "tested" },
      { slug: "tool-scopes", name: "Tool scopes", summary: "Plans.", status: "designed" },
    ],
    technologyGroups: ["core", "ai-engineering-focus", "secondary"],
    ...overrides,
  };
}

const ALL_QUESTIONS = [HIRING, CLIENTS, TECHNICAL, GENERAL, UNKNOWN];

function blocksOf<T extends ChatBlock["type"]>(
  blocks: readonly ChatBlock[],
  type: T,
): Extract<ChatBlock, { type: T }>[] {
  return blocks.filter((block): block is Extract<ChatBlock, { type: T }> => block.type === type);
}

describe("askSuggestions", () => {
  it("offers four questions, one per kind of visitor, about the person by name", () => {
    expect(askSuggestions(NAME).map(({ audience, question }) => [audience, question])).toEqual([
      ["hiring", HIRING],
      ["clients", CLIENTS],
      ["technical", TECHNICAL],
      ["general", GENERAL],
    ]);
  });

  it("gives every suggestion a short label for the hero", () => {
    for (const suggestion of askSuggestions(NAME)) {
      expect(suggestion.label.length).toBeGreaterThan(0);
      expect(suggestion.label.length).toBeLessThanOrEqual(20);
    }
  });
});

describe("heroSuggestions", () => {
  it("offers at most three of the Ask suggestions, never the one without evidence", () => {
    const hero = heroSuggestions(NAME);
    expect(hero.length).toBeGreaterThanOrEqual(2);
    expect(hero.length).toBeLessThanOrEqual(3);
    for (const suggestion of hero) expect(askSuggestions(NAME)).toContainEqual(suggestion);
    expect(hero.map((suggestion) => suggestion.audience)).not.toContain("technical");
  });
});

describe("preparedAnswer", () => {
  it("answers every suggested question from its prepared answer", () => {
    const outcomes = askSuggestions(NAME).map(
      (suggestion) => preparedAnswer(evidence(), suggestion.question).outcome,
    );
    expect(outcomes).toEqual(["answered", "answered", "insufficient_evidence", "answered"]);
  });

  it("recognises a suggested question however it is spaced, cased or punctuated", () => {
    expect(preparedAnswer(evidence(), "  what is casey   morrow working on NOW  ")).toEqual(
      preparedAnswer(evidence(), GENERAL),
    );
  });

  it("speaks about the person, never as the person", () => {
    for (const question of ALL_QUESTIONS) {
      const { text } = preparedAnswer(evidence(), question);
      expect(text).toContain(NAME);
      expect(text).not.toMatch(/\b(I am|I'm|I've|I have worked|my experience|my work)\b/i);
    }
  });

  it("gives every answer one or two valid related links onward", () => {
    for (const question of ALL_QUESTIONS) {
      const { related } = preparedAnswer(evidence(), question);
      expect(related.length).toBeGreaterThanOrEqual(1);
      expect(related.length).toBeLessThanOrEqual(2);
      for (const link of related) expect(ChatRelatedLinkSchema.safeParse(link).success).toBe(true);
    }
  });

  it("gives only blocks and sources the shared chat contract accepts", () => {
    for (const question of ALL_QUESTIONS) {
      const { blocks, sources } = preparedAnswer(evidence(), question);
      for (const block of blocks) expect(ChatBlockSchema.parse(block)).toEqual(block);
      if (sources.length > 0) expect(ChatSourcesSchema.parse(sources)).toEqual(sources);
    }
  });

  it("never prepares a roadmap card: the roadmap's records arrive in phase 4", () => {
    for (const question of ALL_QUESTIONS) {
      expect(blocksOf(preparedAnswer(evidence(), question).blocks, "RoadmapCard")).toEqual([]);
    }
  });

  describe("for hiring", () => {
    it("shows the latest experience as a card leading to it", () => {
      const { blocks } = preparedAnswer(evidence(), HIRING);
      expect(blocks).toEqual([
        {
          type: "ExperienceCard",
          title: "Lead engineer",
          organization: "Fictional Freight",
          startedOn: "2022-03-01",
          endedOn: null,
          summary: "Leads a fictional team.",
          technologies: ["TypeScript", "Postgres"],
          href: anchorHref({ kind: "experience", slug: "lead-engineer" }),
        },
      ]);
    });

    it("rests on the latest experiences, their case studies and the AI engineering focus", () => {
      const { sources } = preparedAnswer(evidence(), HIRING);
      expect(sources).toEqual([
        {
          record: { kind: "experience", id: "lead-engineer" },
          title: "Lead engineer, Fictional Freight",
          href: "/experience#experience-lead-engineer",
        },
        {
          record: { kind: "experience", id: "senior-developer" },
          title: "Senior developer, Fictional Clinic",
          href: "/experience#experience-senior-developer",
        },
        {
          record: { kind: "project", id: "route-planner" },
          title: "Route planner: technical case study",
          href: "/experience#case-study-route-planner",
        },
        {
          record: { kind: "project", id: "clinic-scheduling" },
          title: "Clinic scheduling: technical case study",
          href: "/experience#case-study-clinic-scheduling",
        },
        {
          record: { kind: "technology_group", id: "ai-engineering-focus" },
          title: "AI engineering focus",
          href: "/experience#technology-group-ai-engineering-focus",
        },
      ]);
    });

    it("points each source at its record with the builder its page uses", () => {
      const { sources } = preparedAnswer(evidence(), HIRING);
      expect(sources.map((source) => source.href)).toEqual([
        anchorHref({ kind: "experience", slug: "lead-engineer" }),
        anchorHref({ kind: "experience", slug: "senior-developer" }),
        anchorHref({ kind: "case-study", project: "route-planner" }),
        anchorHref({ kind: "case-study", project: "clinic-scheduling" }),
        anchorHref({ kind: "technology-group", group: "ai-engineering-focus" }),
      ]);
    });

    it("never rests on an exploration, which is not delivered work", () => {
      const { sources } = preparedAnswer(evidence(), HIRING);
      expect(sources.map((source) => source.record.kind)).not.toContain("exploration");
    });

    it("leaves out a technology group the experience page does not show", () => {
      const { sources } = preparedAnswer(evidence({ technologyGroups: ["core"] }), HIRING);
      expect(sources.map((source) => source.record.kind)).not.toContain("technology_group");
    });
  });

  describe("for clients", () => {
    it("shows the first two services as cards leading to them, resting on up to three", () => {
      const { blocks, sources } = preparedAnswer(evidence(), CLIENTS);
      expect(blocks).toEqual([
        {
          type: "ServiceCard",
          title: "Process automation",
          summary: "Automates.",
          href: "/services#service-process-automation",
        },
        {
          type: "ServiceCard",
          title: "Custom software",
          summary: "Builds.",
          href: "/services#service-custom-software",
        },
      ]);
      expect(sources).toEqual(
        ["process-automation", "custom-software", "ai-integration"].map((slug, index) => ({
          record: { kind: "service", id: slug },
          title: ["Process automation", "Custom software", "AI integration"][index],
          href: anchorHref({ kind: "service", slug }),
        })),
      );
    });

    it("says it lacks evidence, with the contact, when the profile has no services", () => {
      const answer = preparedAnswer(evidence({ services: [] }), CLIENTS);
      expect(answer.outcome).toBe("insufficient_evidence");
      expect(answer.text).toContain(`I don't have enough evidence in ${NAME}'s public profile`);
      expect(answer.sources).toEqual([]);
      expect(blocksOf(answer.blocks, "ContactCard")).toHaveLength(1);
    });
  });

  describe("for the strongest skills", () => {
    it("says it lacks evidence instead of ranking skills, offering the contact and no sources", () => {
      const answer = preparedAnswer(evidence(), TECHNICAL);
      expect(answer.outcome).toBe("insufficient_evidence");
      expect(answer.text).toContain(`I don't have enough evidence in ${NAME}'s public profile`);
      expect(answer.text).toContain(`ask ${NAME} directly`);
      expect(answer.sources).toEqual([]);
      expect(answer.blocks).toEqual([
        {
          type: "ContactCard",
          email: "casey@morrow.example.test",
          links: [{ label: "Code", url: "https://code.example.test/casey" }],
        },
      ]);
    });

    it("leaves out a contact link the contract would reject, and the card without any contact", () => {
      const withBadLink = preparedAnswer(
        evidence({
          contact: { email: null, links: [{ label: "Odd", url: "https://192.0.2.1/casey" }] },
        }),
        TECHNICAL,
      );
      expect(withBadLink.blocks).toEqual([]);

      const withoutContact = preparedAnswer(
        evidence({ contact: { email: null, links: [] } }),
        TECHNICAL,
      );
      expect(withoutContact.blocks).toEqual([]);
      expect(withoutContact.outcome).toBe("insufficient_evidence");
    });
  });

  describe("for current work", () => {
    it("shows the explorations as cards with their stored status", () => {
      const cards = blocksOf(preparedAnswer(evidence(), GENERAL).blocks, "ExplorationCard");
      expect(cards).toEqual([
        {
          type: "ExplorationCard",
          title: "Answer checker",
          summary: "Checks.",
          status: "built",
          href: "/experience#exploration-answer-checker",
        },
        {
          type: "ExplorationCard",
          title: "Chunk comparison",
          summary: null,
          status: "tested",
          href: "/experience#exploration-chunk-comparison",
        },
        {
          type: "ExplorationCard",
          title: "Tool scopes",
          summary: "Plans.",
          status: "designed",
          href: "/experience#exploration-tool-scopes",
        },
      ]);
    });

    it("rests only on built or tested explorations, never on a design", () => {
      const { sources } = preparedAnswer(evidence(), GENERAL);
      expect(sources).toEqual([
        {
          record: { kind: "exploration", id: "answer-checker" },
          title: "Answer checker",
          href: anchorHref({ kind: "exploration", slug: "answer-checker" }),
        },
        {
          record: { kind: "exploration", id: "chunk-comparison" },
          title: "Chunk comparison",
          href: anchorHref({ kind: "exploration", slug: "chunk-comparison" }),
        },
      ]);
    });

    it("says what a design is, so a designed exploration never reads as delivered work", () => {
      const { text } = preparedAnswer(evidence(), GENERAL);
      expect(text).toMatch(/designed/i);
      expect(text).toMatch(/not (yet )?implemented|unimplemented/i);
    });

    it("says it lacks evidence, with the contact, when the profile has no explorations", () => {
      const answer = preparedAnswer(evidence({ explorations: [] }), GENERAL);
      expect(answer.outcome).toBe("insufficient_evidence");
      expect(answer.text).toContain(`I don't have enough evidence in ${NAME}'s public profile`);
      expect(answer.text).not.toMatch(/lists the current explorations/i);
      expect(answer.sources).toEqual([]);
      expect(answer.blocks.map((block) => block.type)).toEqual(["ContactCard"]);
      // The experience page has no independent R&D block without explorations.
      expect(answer.related.map((link) => link.href)).toEqual(["/#contact"]);
    });

    it("says it lacks evidence when every exploration is only designed, never citing a design", () => {
      const answer = preparedAnswer(
        evidence({
          explorations: [
            { slug: "tool-scopes", name: "Tool scopes", summary: null, status: "designed" },
          ],
        }),
        GENERAL,
      );
      expect(answer.outcome).toBe("insufficient_evidence");
      expect(answer.sources).toEqual([]);
      expect(answer.text).toMatch(/not (yet )?implemented|unimplemented/i);
      expect(answer.blocks.map((block) => block.type)).toEqual(["ContactCard"]);
      expect(answer.related.map((link) => link.href)).toEqual(["/experience#independent-rd"]);
    });
  });

  it("tells any other question that the assistant is not connected yet, without blocks or sources", () => {
    const answer = preparedAnswer(evidence(), UNKNOWN);
    expect(answer.outcome).toBe("unavailable");
    expect(answer.text).toContain("not connected yet");
    expect(answer.blocks).toEqual([]);
    expect(answer.sources).toEqual([]);
    expect(answer.related.map((link) => link.href)).toEqual(["/experience", "/services"]);
  });

  it("drops a card the contract would reject rather than emit it", () => {
    const answer = preparedAnswer(
      evidence({
        services: [{ slug: "long", name: "x".repeat(201), summary: "Too long a name." }],
      }),
      CLIENTS,
    );
    expect(blocksOf(answer.blocks, "ServiceCard")).toEqual([]);
    expect(answer.sources).toEqual([]);
  });
});
