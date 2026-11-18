import { describe, expect, it } from "vitest";

import { profileStructuredData, serializeJsonLd, type StructuredProfile } from "./structured-data";

const ORIGIN = "https://site.example.test";

function profile(overrides: Partial<StructuredProfile> = {}): StructuredProfile {
  return {
    name: "Robin Example",
    headline: "Fictional engineer for tests",
    shortBio: "Robin is **made up** for the tests.",
    photo: {
      url: "https://media.example.test/files/test/portrait.png",
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
      image: "https://media.example.test/files/test/portrait.png",
      email: "robin@example.test",
      sameAs: ["https://code.example.test/robin", "https://notes.example.test/"],
    });
  });

  it("leaves out a photo, an email and links the profile does not have", () => {
    const person = node(
      profileStructuredData(ORIGIN, profile({ photo: null, contact: { email: null, links: [] } })),
      "Person",
    );
    expect(person).not.toHaveProperty("image");
    expect(person).not.toHaveProperty("email");
    expect(person).not.toHaveProperty("sameAs");
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
      name: "Robin Example — Fictional engineer for tests",
      description: "Robin is made up for the tests.",
      isPartOf: { "@id": "http://other.example.test/#website" },
      mainEntity: { "@id": "http://other.example.test/#person" },
    });
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
