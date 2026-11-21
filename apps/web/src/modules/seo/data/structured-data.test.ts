import { describe, expect, it } from "vitest";

import { pageMetadata } from "./page-metadata";
import {
  cvStructuredData,
  experienceStructuredData,
  profileStructuredData,
  serializeJsonLd,
  servicesStructuredData,
  type StructuredCv,
  type StructuredExperience,
  type StructuredProfile,
  type StructuredServices,
} from "./structured-data";

const ORIGIN = "https://site.example.test";

// Fictional roles: a current job, a current business of the person's own, a current side project
// and a job that ended.
const EXPERIENCES = [
  {
    slug: "signal-works",
    title: "Lead engineer",
    kind: "main_job",
    endedOn: null,
    summary: "Builds **fictional** signal tools for [tests](https://example.test).\n\nMore later.",
    organization: { name: "Signal Works", website: "https://signal.example.test/" },
  },
  {
    slug: "robin-studio",
    title: "Consultant",
    kind: "own_business",
    endedOn: null,
    summary: "Advises fictional teams.",
    organization: { name: "Robin Studio", website: null },
  },
  {
    slug: "tiny-lib",
    title: "Maintainer",
    kind: "side_project",
    endedOn: null,
    summary: "Keeps a fictional library alive.",
    organization: { name: "tiny-lib", website: "https://tiny.example.test/" },
  },
  {
    slug: "old-corp",
    title: "Engineer",
    kind: "main_job",
    endedOn: "2020-01-31",
    summary: "",
    organization: { name: "Old Corp", website: "https://old.example.test/" },
  },
] as const satisfies StructuredExperience["experiences"];

const TECHNOLOGIES = [{ name: "TypeScript" }, { name: "PostgreSQL" }, { name: "Evals" }];

function profile(overrides: Partial<StructuredProfile> = {}): StructuredProfile {
  return {
    name: "Robin Example",
    headline: "Fictional engineer for tests",
    shortBio: "Robin is **made up** for the tests.",
    photo: {
      url: "/media/portrait.png",
      altText: "A fictional portrait.",
      width: 640,
      height: 800,
    },
    contact: {
      email: { address: "robin@example.test", href: "mailto:robin@example.test" },
      links: [
        { label: "Code", url: "https://code.example.test/robin" },
        { label: "Notes", url: "https://notes.example.test/" },
      ],
    },
    experiences: EXPERIENCES,
    technologies: TECHNOLOGIES,
    ...overrides,
  };
}

type Node = Record<string, unknown>;

function nodes(value: object): Node[] {
  const graph = (value as { "@graph": Node[] })["@graph"];
  return graph;
}

function node(value: object, type: string): Node {
  const found = nodes(value).find((item) => item["@type"] === type);
  if (found === undefined) throw new Error(`No ${type} node`);
  return found;
}

describe("profileStructuredData", () => {
  it("describes the site, the profile page and the person with schema.org", () => {
    const data = profileStructuredData(ORIGIN, profile());
    expect(data).toMatchObject({ "@context": "https://schema.org" });
    expect(nodes(data).map((item) => item["@type"])).toEqual(["WebSite", "ProfilePage", "Person"]);
  });

  it("states only what the profile holds about the person", () => {
    expect(node(profileStructuredData(ORIGIN, profile()), "Person")).toEqual({
      "@type": "Person",
      "@id": "https://site.example.test/#person",
      name: "Robin Example",
      description: "Fictional engineer for tests",
      url: "https://site.example.test/",
      image: "https://site.example.test/media/portrait.png",
      email: "robin@example.test",
      sameAs: ["https://code.example.test/robin", "https://notes.example.test/"],
      jobTitle: ["Lead engineer", "Consultant"],
      worksFor: [
        { "@type": "Organization", name: "Signal Works", url: "https://signal.example.test/" },
        { "@type": "Organization", name: "Robin Studio" },
      ],
      knowsAbout: ["TypeScript", "PostgreSQL", "Evals"],
    });
  });

  it("names the job and employer of the person's current work, not side projects or past jobs", () => {
    const person = node(
      profileStructuredData(ORIGIN, profile({ experiences: [EXPERIENCES[0], EXPERIENCES[3]] })),
      "Person",
    );
    expect(person).toMatchObject({
      jobTitle: "Lead engineer",
      worksFor: {
        "@type": "Organization",
        name: "Signal Works",
        url: "https://signal.example.test/",
      },
    });
  });

  it("names each job title and employer once", () => {
    const again = { ...EXPERIENCES[0], slug: "signal-works-again" };
    const person = node(
      profileStructuredData(ORIGIN, profile({ experiences: [EXPERIENCES[0], again] })),
      "Person",
    );
    expect(person).toMatchObject({ jobTitle: "Lead engineer", worksFor: { name: "Signal Works" } });
  });

  it("leaves out an employer's address that is not a web address", () => {
    const odd = {
      ...EXPERIENCES[0],
      organization: { name: "Signal Works", website: "javascript:alert(1)" },
    };
    const person = node(profileStructuredData(ORIGIN, profile({ experiences: [odd] })), "Person");
    expect(person["worksFor"]).toEqual({ "@type": "Organization", name: "Signal Works" });
  });

  it("leaves out a photo, an email, links, a job, an employer and skills the profile does not have", () => {
    const person = node(
      profileStructuredData(
        ORIGIN,
        profile({
          photo: null,
          contact: { email: null, links: [] },
          experiences: [EXPERIENCES[2], EXPERIENCES[3]],
          technologies: [],
        }),
      ),
      "Person",
    );
    expect(person).not.toHaveProperty("image");
    expect(person).not.toHaveProperty("email");
    expect(person).not.toHaveProperty("sameAs");
    expect(person).not.toHaveProperty("jobTitle");
    expect(person).not.toHaveProperty("worksFor");
    expect(person).not.toHaveProperty("knowsAbout");
  });

  it("names the profile page with the whole headline, which structured data need not shorten", () => {
    const headline =
      "Fictional engineer who builds calm software for logistics, health care and public services";
    const data = profileStructuredData(ORIGIN, profile({ headline }));
    expect(node(data, "ProfilePage")["name"]).toBe(`Robin Example · ${headline}`);
  });

  it("links the site and the profile page to the person on the configured origin", () => {
    const data = profileStructuredData("http://other.example.test", profile());
    expect(node(data, "WebSite")).toEqual({
      "@type": "WebSite",
      "@id": "http://other.example.test/#website",
      url: "http://other.example.test/",
      name: "Robin Example",
      description: "Fictional engineer for tests",
      inLanguage: "en",
      publisher: { "@id": "http://other.example.test/#person" },
    });
    expect(node(data, "ProfilePage")).toEqual({
      "@type": "ProfilePage",
      "@id": "http://other.example.test/#profile-page",
      url: "http://other.example.test/",
      name: "Robin Example · Fictional engineer for tests",
      description: "Robin is made up for the tests.",
      isPartOf: { "@id": "http://other.example.test/#website" },
      mainEntity: { "@id": "http://other.example.test/#person" },
    });
  });
});

function experienceContent(overrides: Partial<StructuredExperience> = {}): StructuredExperience {
  return {
    name: "Robin Example",
    headline: "Fictional engineer for tests",
    experiences: EXPERIENCES,
    technologies: TECHNOLOGIES,
    ...overrides,
  };
}

describe("experienceStructuredData", () => {
  it("describes the page, the person and the experiences in their order", () => {
    const data = experienceStructuredData(ORIGIN, experienceContent());
    expect(data).toMatchObject({ "@context": "https://schema.org" });
    expect(nodes(data).map((item) => item["@type"])).toEqual(["WebPage", "Person", "ItemList"]);
  });

  it("names the page as its metadata does, about the person and part of the website", () => {
    const content = experienceContent();
    expect(node(experienceStructuredData(ORIGIN, content), "WebPage")).toEqual({
      "@type": "WebPage",
      "@id": "https://site.example.test/experience#webpage",
      url: "https://site.example.test/experience",
      name: pageMetadata(ORIGIN, "experience", content).title,
      description: "Fictional engineer for tests",
      inLanguage: "en",
      isPartOf: { "@id": "https://site.example.test/#website" },
      about: { "@id": "https://site.example.test/#person" },
      mainEntity: { "@id": "https://site.example.test/experience#experiences" },
    });
  });

  it("describes the person with the current job, employer and skills", () => {
    expect(node(experienceStructuredData(ORIGIN, experienceContent()), "Person")).toEqual({
      "@type": "Person",
      "@id": "https://site.example.test/#person",
      name: "Robin Example",
      description: "Fictional engineer for tests",
      url: "https://site.example.test/",
      jobTitle: ["Lead engineer", "Consultant"],
      worksFor: [
        { "@type": "Organization", name: "Signal Works", url: "https://signal.example.test/" },
        { "@type": "Organization", name: "Robin Studio" },
      ],
      knowsAbout: ["TypeScript", "PostgreSQL", "Evals"],
    });
  });

  it("lists each experience with its role, organization, anchor and summary as plain text", () => {
    const list = node(experienceStructuredData(ORIGIN, experienceContent()), "ItemList");
    expect(list).toMatchObject({
      "@id": "https://site.example.test/experience#experiences",
      name: "Experience",
      numberOfItems: 4,
    });
    expect(list["itemListElement"]).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "Lead engineer at Signal Works",
        url: "https://site.example.test/experience#experience-signal-works",
        description: "Builds fictional signal tools for tests.",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Consultant at Robin Studio",
        url: "https://site.example.test/experience#experience-robin-studio",
        description: "Advises fictional teams.",
      },
      {
        "@type": "ListItem",
        position: 3,
        name: "Maintainer at tiny-lib",
        url: "https://site.example.test/experience#experience-tiny-lib",
        description: "Keeps a fictional library alive.",
      },
      {
        "@type": "ListItem",
        position: 4,
        name: "Engineer at Old Corp",
        url: "https://site.example.test/experience#experience-old-corp",
      },
    ]);
  });

  it("leaves out the list when there are no experiences", () => {
    const data = experienceStructuredData(
      ORIGIN,
      experienceContent({ experiences: [], technologies: [] }),
    );
    expect(nodes(data).map((item) => item["@type"])).toEqual(["WebPage", "Person"]);
    expect(node(data, "WebPage")).not.toHaveProperty("mainEntity");
    expect(node(data, "Person")).not.toHaveProperty("knowsAbout");
  });
});

function servicesContent(overrides: Partial<StructuredServices> = {}): StructuredServices {
  return {
    name: "Robin Example",
    headline: "Fictional engineer for tests",
    intro: "Robin helps **fictional** teams.\n\nMore later.",
    services: [
      {
        slug: "audits",
        name: "Signal audits",
        summary: "A **fictional** audit of your signals.",
        audience: "Teams with _made-up_ signals",
      },
      { slug: "pairing", name: "Pairing", summary: "", audience: "" },
    ],
    ...overrides,
  };
}

describe("servicesStructuredData", () => {
  it("describes the page, the person and the services", () => {
    const data = servicesStructuredData(ORIGIN, servicesContent());
    expect(data).toMatchObject({ "@context": "https://schema.org" });
    expect(nodes(data).map((item) => item["@type"])).toEqual(["WebPage", "Person", "ItemList"]);
    const content = servicesContent();
    expect(node(data, "WebPage")).toEqual({
      "@type": "WebPage",
      "@id": "https://site.example.test/services#webpage",
      url: "https://site.example.test/services",
      name: pageMetadata(ORIGIN, "services", { ...content, summary: content.intro }).title,
      description: "Robin helps fictional teams.",
      inLanguage: "en",
      isPartOf: { "@id": "https://site.example.test/#website" },
      about: { "@id": "https://site.example.test/#person" },
      mainEntity: { "@id": "https://site.example.test/services#services" },
    });
    expect(node(data, "Person")).toEqual({
      "@type": "Person",
      "@id": "https://site.example.test/#person",
      name: "Robin Example",
      description: "Fictional engineer for tests",
      url: "https://site.example.test/",
    });
  });

  it("lists each service the person provides, with its audience, as plain text", () => {
    const list = node(servicesStructuredData(ORIGIN, servicesContent()), "ItemList");
    expect(list).toMatchObject({
      "@id": "https://site.example.test/services#services",
      name: "Services",
      numberOfItems: 2,
    });
    expect(list["itemListElement"]).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        item: {
          "@type": "Service",
          "@id": "https://site.example.test/services#service-audits",
          url: "https://site.example.test/services#service-audits",
          name: "Signal audits",
          description: "A fictional audit of your signals.",
          provider: { "@id": "https://site.example.test/#person" },
          audience: { "@type": "Audience", audienceType: "Teams with made-up signals" },
        },
      },
      {
        "@type": "ListItem",
        position: 2,
        item: {
          "@type": "Service",
          "@id": "https://site.example.test/services#service-pairing",
          url: "https://site.example.test/services#service-pairing",
          name: "Pairing",
          provider: { "@id": "https://site.example.test/#person" },
        },
      },
    ]);
  });

  it("describes the page by the headline without an intro, and leaves out an empty list", () => {
    const data = servicesStructuredData(ORIGIN, servicesContent({ intro: null, services: [] }));
    expect(nodes(data).map((item) => item["@type"])).toEqual(["WebPage", "Person"]);
    expect(node(data, "WebPage")).toMatchObject({ description: "Fictional engineer for tests" });
    expect(node(data, "WebPage")).not.toHaveProperty("mainEntity");
  });
});

function cvContent(overrides: Partial<StructuredCv> = {}): StructuredCv {
  return {
    name: "Robin Example",
    headline: "Fictional engineer for tests",
    shortBio: "Robin is **made up** for the tests.",
    contact: {
      email: { address: "robin@example.test", href: "mailto:robin@example.test" },
      links: [{ label: "Code", url: "https://code.example.test/robin" }],
    },
    experiences: EXPERIENCES,
    technologies: {
      primary: { core: [{ name: "TypeScript" }], aiEngineeringFocus: [{ name: "Evals" }] },
      secondary: [{ name: "PostgreSQL" }],
    },
    ...overrides,
  };
}

describe("cvStructuredData", () => {
  it("describes the CV as the person's profile page", () => {
    const content = cvContent();
    const data = cvStructuredData(ORIGIN, content);
    expect(data).toMatchObject({ "@context": "https://schema.org" });
    expect(nodes(data).map((item) => item["@type"])).toEqual(["ProfilePage", "Person"]);
    expect(node(data, "ProfilePage")).toEqual({
      "@type": "ProfilePage",
      "@id": "https://site.example.test/cv#webpage",
      url: "https://site.example.test/cv",
      name: pageMetadata(ORIGIN, "cv", { ...content, summary: content.shortBio }).title,
      description: "Robin is made up for the tests.",
      inLanguage: "en",
      isPartOf: { "@id": "https://site.example.test/#website" },
      mainEntity: { "@id": "https://site.example.test/#person" },
    });
  });

  it("describes the person with the contacts, current jobs, employers and every skill group", () => {
    expect(node(cvStructuredData(ORIGIN, cvContent()), "Person")).toEqual({
      "@type": "Person",
      "@id": "https://site.example.test/#person",
      name: "Robin Example",
      description: "Fictional engineer for tests",
      url: "https://site.example.test/",
      email: "robin@example.test",
      sameAs: ["https://code.example.test/robin"],
      jobTitle: ["Lead engineer", "Consultant"],
      worksFor: [
        { "@type": "Organization", name: "Signal Works", url: "https://signal.example.test/" },
        { "@type": "Organization", name: "Robin Studio" },
      ],
      knowsAbout: ["TypeScript", "Evals", "PostgreSQL"],
    });
  });

  it("leaves out what the CV does not hold", () => {
    const person = node(
      cvStructuredData(
        ORIGIN,
        cvContent({
          contact: { email: null, links: [] },
          experiences: [],
          technologies: { primary: { core: [], aiEngineeringFocus: [] }, secondary: [] },
        }),
      ),
      "Person",
    );
    expect(Object.keys(person).sort()).toEqual(["@id", "@type", "description", "name", "url"]);
  });
});

describe("serializeJsonLd", () => {
  it("cannot close the script element or open another one", () => {
    const text = serializeJsonLd({ name: "</script><script>alert(1)</script><!--" });
    expect(text).not.toMatch(/[<>]/);
    expect(text.toLowerCase()).not.toContain("</script");
  });

  it("escapes ampersands and the line separators JavaScript reads as line ends", () => {
    const text = serializeJsonLd({ name: "A & B\u2028C\u2029D" });
    expect(text).not.toMatch(/[&\u2028\u2029]/);
  });

  it("stays the same data when parsed as JSON", () => {
    const value = {
      name: "</script><script>alert(1)</script>",
      note: "A & B\u2028C\u2029D 'quoted' \"double\" \\ ü",
      list: [1, null, true],
    };
    expect(JSON.parse(serializeJsonLd(value))).toEqual(value);
  });
});
