import { describe, expect, it } from "vitest";

import type { Experience, Exploration, Service } from "@sebela/api-client";

import type { HomepageProfile } from "../../profile";
import { llmsTxt } from "./llms-txt";

const ORIGIN = "https://site.example.test";
const STAMP = "2026-01-01T00:00:00.000Z";

function experience(overrides: Partial<Experience> = {}): Experience {
  return {
    id: "6c1d3e5f-7a9b-4c2d-8e0f-1a3b5c7d9e21",
    slug: "fictional-staff-engineer",
    title: "Staff engineer",
    kind: "main_job",
    startedOn: "2022-01-03",
    endedOn: null,
    summary: "Fictional **work** for tests.\n\nA second paragraph.",
    responsibilities: [],
    inCv: true,
    organization: {
      id: "7d2e4f6a-8b0c-4d3e-9f1a-2b4c6d8e0f32",
      slug: "fictional-company",
      name: "Fictional Company",
      website: null,
      description: null,
      logoId: null,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    technologies: [],
    projects: [],
    testimonials: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function exploration(overrides: Partial<Exploration> = {}): Exploration {
  return {
    id: "0a5b7c9d-1e3f-4a6b-8c4d-5e7f9a1b3c65",
    slug: "fictional-exploration",
    name: "Fictional exploration",
    summary: "A made-up experiment.",
    status: "designed",
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

function service(overrides: Partial<Service> = {}): Service {
  return {
    id: "1b6c8d0e-2f4a-4b7c-9d5e-6f8a0b2c4d76",
    slug: "fictional-service",
    name: "Fictional service",
    summary: "A made-up service.",
    audience: "Fictional teams.",
    deliverable: "A fictional tool.",
    position: 0,
    evidence: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function profile(overrides: Partial<HomepageProfile> = {}): HomepageProfile {
  return {
    name: "Robin Example",
    headline: "Fictional engineer for tests",
    shortBio: "Robin is **made up** for the tests.",
    photo: null,
    contact: {
      email: { address: "robin@example.test", href: "mailto:robin@example.test" },
      links: [{ label: "Code", url: "https://code.example.test/robin" }],
    },
    careerStartedOn: null,
    experiences: [experience()],
    projects: [],
    technologies: [],
    currentFocus: [],
    explorations: [exploration()],
    services: [service()],
    cvPdf: { updatedOn: "2026-03-01" },
    ...overrides,
  };
}

describe("llmsTxt", () => {
  it("writes the profile in the llms.txt layout on the configured origin", () => {
    expect(llmsTxt(ORIGIN, profile())).toBe(
      [
        "# Robin Example",
        "",
        "> Fictional engineer for tests",
        "",
        "Robin is made up for the tests.",
        "",
        "## Pages",
        "",
        "- [Home](https://site.example.test/): Profile, selected work, current focus and contact",
        "- [Experience](https://site.example.test/experience): Career timeline, projects, technologies and independent R&D",
        "- [Services](https://site.example.test/services): Services on offer and how a collaboration runs",
        "- [CV](https://site.example.test/cv): The CV as a web page",
        "- [CV (PDF)](https://site.example.test/cv/pdf): The current CV as a PDF, uploaded on March 1st, 2026",
        "",
        "## Experience",
        "",
        "- [Staff engineer, Fictional Company](https://site.example.test/experience#experience-fictional-staff-engineer): January 3rd, 2022 – present. Fictional work for tests.",
        "",
        "## Services",
        "",
        "- [Fictional service](https://site.example.test/services#service-fictional-service): A made-up service.",
        "",
        "## Independent R&D",
        "",
        "- [Fictional exploration](https://site.example.test/experience#exploration-fictional-exploration): Designed (unimplemented design, planned or architected only). A made-up experiment.",
        "",
        "## Contact",
        "",
        "- Email: robin@example.test",
        "- [Code](https://code.example.test/robin)",
        "",
      ].join("\n"),
    );
  });

  it("follows another configured origin", () => {
    const text = llmsTxt("http://other.example.test:4100", profile());
    expect(text).toContain("- [Home](http://other.example.test:4100/)");
    expect(text).not.toContain("site.example.test");
  });

  it("leaves out sections and the PDF the profile does not have", () => {
    const text = llmsTxt(
      ORIGIN,
      profile({
        experiences: [],
        services: [],
        explorations: [],
        cvPdf: null,
        contact: { email: null, links: [] },
      }),
    );
    expect(text).not.toMatch(/## (?:Experience|Services|Independent R&D|Contact)/);
    expect(text).not.toContain("/cv/pdf");
    expect(text).toContain("## Pages");
  });

  it("never lists the chat, its conversations or a roadmap page", () => {
    const text = llmsTxt(ORIGIN, profile());
    expect(text).not.toMatch(/\/ask|\/ai-roadmap|\?c=/);
  });

  it("keeps unsafe text from breaking the Markdown structure", () => {
    const text = llmsTxt(
      ORIGIN,
      profile({
        name: "Robin\n## Injected",
        headline: "Line one\n\n# Line two",
        experiences: [
          experience({
            title: "Lead](https://evil.example.test) [x",
            summary: "Text\n- not a list item",
          }),
        ],
        services: [service({ name: "A \\ B [C]" })],
      }),
    );
    expect(text).toContain("# Robin ## Injected\n");
    expect(text).toContain("> Line one # Line two\n");
    expect(text).not.toMatch(/^## Injected/m);
    expect(text).toContain("[Lead\\](https://evil.example.test) \\[x, Fictional Company](");
    expect(text).toContain(": January 3rd, 2022 – present. Text - not a list item\n");
    expect(text).toContain("[A \\\\ B \\[C\\]](");
    expect(text).not.toMatch(/[^\\]\]\(https:\/\/evil/);
  });

  it("keeps a contact link's address from closing the link", () => {
    const text = llmsTxt(
      ORIGIN,
      profile({
        contact: {
          email: null,
          links: [{ label: "Notes", url: "https://notes.example.test/a b)(c" }],
        },
      }),
    );
    expect(text).toContain("- [Notes](https://notes.example.test/a%20b%29%28c)\n");
  });

  it("leaves out a contact link that is not a web address", () => {
    const text = llmsTxt(
      ORIGIN,
      profile({
        contact: { email: null, links: [{ label: "Script", url: "javascript:alert(1)" }] },
      }),
    );
    expect(text).not.toContain("javascript:");
    expect(text).not.toContain("## Contact");
  });
});
