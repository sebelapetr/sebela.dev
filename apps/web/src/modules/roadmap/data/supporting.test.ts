import { describe, expect, it } from "vitest";

import type {
  RoadmapFollowedSource,
  RoadmapGlossaryTerm,
  RoadmapProjectIdea,
} from "@sebela/api-client";

import { toSupportingSections } from "./supporting";

const STAMP = "2026-01-01T00:00:00.000Z";

function idea(overrides: Partial<RoadmapProjectIdea> = {}): RoadmapProjectIdea {
  return {
    id: "b1000000-0000-4000-8000-000000000001",
    slug: "fictional-idea",
    title: "Fictional idea",
    whyItMatters: "It is **made up**.",
    howToStart: "Start with a _small_ prototype.",
    position: 0,
    topics: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function topic(slug: string, name: string, position: number) {
  return {
    id: `b2000000-0000-4000-8000-00000000000${String(position)}`,
    slug,
    name,
    position,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function source(overrides: Partial<RoadmapFollowedSource> = {}): RoadmapFollowedSource {
  return {
    id: "b3000000-0000-4000-8000-000000000001",
    slug: "fictional-source",
    title: "Fictional source",
    description: "A made-up **newsletter**.",
    link: "https://source.example.test/feed",
    kind: "Newsletter",
    position: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function term(overrides: Partial<RoadmapGlossaryTerm> = {}): RoadmapGlossaryTerm {
  return {
    id: "b4000000-0000-4000-8000-000000000001",
    slug: "fictional-term",
    term: "Fictional term",
    description: "A term made up for the tests.",
    position: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

describe("toSupportingSections", () => {
  it("numbers the project ideas in the API's order with their topics' names in order", () => {
    const sections = toSupportingSections({
      projectIdeas: [
        idea({
          topics: [topic("evals", "Evaluations", 0), topic("retrieval", "Retrieval", 1)],
        }),
        idea({ slug: "second-idea", title: "Second idea", howToStart: null, position: 1 }),
      ],
      followedSources: [],
      glossaryTerms: [],
    });

    expect(sections.projectIdeas).toEqual([
      {
        slug: "fictional-idea",
        order: "1.",
        title: "Fictional idea",
        whyItMatters: "It is **made up**.",
        howToStart: "Start with a _small_ prototype.",
        topics: ["Evaluations", "Retrieval"],
      },
      {
        slug: "second-idea",
        order: "2.",
        title: "Second idea",
        whyItMatters: "It is **made up**.",
        howToStart: null,
        topics: [],
      },
    ]);
  });

  it("keeps a followed source's link only when it is a safe web address", () => {
    const sections = toSupportingSections({
      projectIdeas: [],
      followedSources: [
        source(),
        source({ slug: "no-link", link: null, description: null }),
        source({ slug: "script", link: "javascript:alert(1)" }),
        source({ slug: "data", link: "data:text/html,<p>hi</p>" }),
        source({ slug: "plain-http", link: "http://source.example.test/" }),
      ],
      glossaryTerms: [],
    });

    expect(sections.followedSources.map(({ slug, href }) => [slug, href])).toEqual([
      ["fictional-source", "https://source.example.test/feed"],
      ["no-link", null],
      ["script", null],
      ["data", null],
      ["plain-http", "http://source.example.test/"],
    ]);
    expect(sections.followedSources[0]).toEqual({
      slug: "fictional-source",
      title: "Fictional source",
      kind: "Newsletter",
      description: "A made-up **newsletter**.",
      href: "https://source.example.test/feed",
    });
    expect(sections.followedSources[1]?.description).toBeNull();
  });

  it("drops a source's kind that is only white space instead of showing an empty label", () => {
    const sections = toSupportingSections({
      projectIdeas: [],
      followedSources: [source({ kind: "  " }), source({ slug: "padded", kind: " Podcast " })],
      glossaryTerms: [],
    });

    expect(sections.followedSources.map((row) => row.kind)).toEqual([null, "Podcast"]);
  });

  it("lists the additional terms in the API's order with their descriptions", () => {
    const sections = toSupportingSections({
      projectIdeas: [],
      followedSources: [],
      glossaryTerms: [term(), term({ slug: "second", term: "Second term", description: "Two." })],
    });

    expect(sections.glossaryTerms).toEqual([
      {
        slug: "fictional-term",
        term: "Fictional term",
        description: "A term made up for the tests.",
      },
      { slug: "second", term: "Second term", description: "Two." },
    ]);
  });

  it("is empty without supporting content", () => {
    expect(
      toSupportingSections({ projectIdeas: [], followedSources: [], glossaryTerms: [] }),
    ).toEqual({ projectIdeas: [], followedSources: [], glossaryTerms: [] });
  });
});
