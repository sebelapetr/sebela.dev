// The schema.org JSON-LD of the main pages: the homepage's website, profile page and person; the
// experience page as a WebPage with an ItemList of the person's roles; the services page as a
// WebPage with an ItemList of the Services the person provides; the CV as the person's ProfilePage.
// The person is one node (`/#person`) everywhere, with the job titles and employers of the
// person's current paid work and the technologies the page holds as `knowsAbout`. Everything comes
// from the page's own API read; a property the read does not hold is left out, never emitted empty.
import { anchorId, plainText } from "../../_shared";
import type { HomepageProfile } from "../../profile";
import { pageText, type PageText } from "./page-metadata";

/** A role of the person's, as the person's structured data reads it. */
export interface StructuredRole {
  readonly slug: string;
  readonly title: string;
  readonly kind: "main_job" | "side_project" | "own_business";
  /** The role's last day, `YYYY-MM-DD`; null while it is current. */
  readonly endedOn: string | null;
  /** Markdown. */
  readonly summary: string;
  readonly organization: { readonly name: string; readonly website: string | null };
}

/** A technology the person works with; its name is all the structured data states. */
export interface StructuredSkill {
  readonly name: string;
}

/** What the homepage's structured data rests on. */
export interface StructuredProfile {
  readonly name: string;
  readonly headline: string;
  /** Markdown. */
  readonly shortBio: string;
  readonly photo: HomepageProfile["photo"];
  readonly contact: HomepageProfile["contact"];
  readonly experiences: readonly StructuredRole[];
  readonly technologies: readonly StructuredSkill[];
}

/** What the experience page's structured data rests on. */
export interface StructuredExperience {
  readonly name: string;
  readonly headline: string;
  readonly experiences: readonly StructuredRole[];
  readonly technologies: readonly StructuredSkill[];
}

/** What the services page's structured data rests on. */
export interface StructuredServices {
  readonly name: string;
  readonly headline: string;
  /** Markdown, or null. */
  readonly intro: string | null;
  readonly services: readonly {
    readonly slug: string;
    readonly name: string;
    /** Markdown. */
    readonly summary: string;
    /** Markdown; empty when the service names no audience. */
    readonly audience: string;
  }[];
}

/** What the CV's structured data rests on. */
export interface StructuredCv {
  readonly name: string;
  readonly headline: string;
  /** Markdown. */
  readonly shortBio: string;
  readonly contact: HomepageProfile["contact"];
  readonly experiences: readonly StructuredRole[];
  readonly technologies: {
    readonly primary: {
      readonly core: readonly StructuredSkill[];
      readonly aiEngineeringFocus: readonly StructuredSkill[];
    };
    readonly secondary: readonly StructuredSkill[];
  };
}

/** The longest description of a listed item, as long as a search result's. */
const DESCRIPTION_MAX = 160;

/** The schema.org graph of the homepage on `origin`: a WebSite, a ProfilePage and a Person. */
export function profileStructuredData(origin: string, profile: StructuredProfile): object {
  const home = `${origin}/`;
  const ids = siteIds(origin);
  const page = pageText(origin, "home", profile);
  const bio = plainText(profile.shortBio);
  return graph([
    {
      "@type": "WebSite",
      "@id": ids.website,
      url: home,
      name: profile.name,
      description: profile.headline,
      inLanguage: "en",
      publisher: { "@id": ids.person },
    },
    {
      "@type": "ProfilePage",
      "@id": `${home}#profile-page`,
      url: home,
      name: page.title,
      ...(bio === "" ? {} : { description: bio }),
      isPartOf: { "@id": ids.website },
      mainEntity: { "@id": ids.person },
    },
    personNode(origin, profile, {
      image: profile.photo === null ? null : new URL(profile.photo.url, home).href,
      contact: profile.contact,
      experiences: profile.experiences,
      skills: profile.technologies,
    }),
  ]);
}

/**
 * The schema.org graph of the experience page on `origin`: the page, the person with the current
 * jobs, employers and technologies, and an ItemList of every role in the page's order, each linked
 * to its anchor on the page. The list is left out when there are no roles.
 */
export function experienceStructuredData(origin: string, content: StructuredExperience): object {
  const page = pageText(origin, "experience", content);
  const listId = `${page.url}#experiences`;
  const items = content.experiences.map((role) => ({
    name: `${role.title} at ${role.organization.name}`,
    url: `${page.url}#${anchorId({ kind: "experience", slug: role.slug })}`,
    description: plainText(role.summary, DESCRIPTION_MAX),
  }));
  return graph([
    webPage(origin, page, items.length === 0 ? null : listId),
    personNode(origin, content, { experiences: content.experiences, skills: content.technologies }),
    ...(items.length === 0
      ? []
      : [
          {
            "@type": "ItemList",
            "@id": listId,
            name: "Experience",
            numberOfItems: items.length,
            itemListElement: items.map((item, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: item.name,
              url: item.url,
              ...nonEmpty("description", item.description),
            })),
          },
        ]),
  ]);
}

/**
 * The schema.org graph of the services page on `origin`: the page (described by the intro, or the
 * headline without one), the person, and an ItemList of the Services the person provides in the
 * page's order, each with its anchor, description and audience when it has them. The list is left
 * out when there are no services.
 */
export function servicesStructuredData(origin: string, content: StructuredServices): object {
  const page = pageText(origin, "services", { ...content, summary: content.intro });
  const ids = siteIds(origin);
  const listId = `${page.url}#services`;
  return graph([
    webPage(origin, page, content.services.length === 0 ? null : listId),
    personNode(origin, content, {}),
    ...(content.services.length === 0
      ? []
      : [
          {
            "@type": "ItemList",
            "@id": listId,
            name: "Services",
            numberOfItems: content.services.length,
            itemListElement: content.services.map((service, index) => {
              const url = `${page.url}#${anchorId({ kind: "service", slug: service.slug })}`;
              const audience = plainText(service.audience);
              return {
                "@type": "ListItem",
                position: index + 1,
                item: {
                  "@type": "Service",
                  "@id": url,
                  url,
                  name: service.name,
                  ...nonEmpty("description", plainText(service.summary, DESCRIPTION_MAX)),
                  provider: { "@id": ids.person },
                  ...(audience === ""
                    ? {}
                    : { audience: { "@type": "Audience", audienceType: audience } }),
                },
              };
            }),
          },
        ]),
  ]);
}

/**
 * The schema.org graph of the CV on `origin`: the CV as the person's ProfilePage, and the person
 * with the contacts, the current jobs and employers and every skill group's technologies (core,
 * then the AI engineering focus, then the rest).
 */
export function cvStructuredData(origin: string, content: StructuredCv): object {
  const page = pageText(origin, "cv", { ...content, summary: content.shortBio });
  const ids = siteIds(origin);
  const { primary, secondary } = content.technologies;
  return graph([
    {
      "@type": "ProfilePage",
      "@id": `${page.url}#webpage`,
      url: page.url,
      name: page.title,
      description: page.description,
      inLanguage: "en",
      isPartOf: { "@id": ids.website },
      mainEntity: { "@id": ids.person },
    },
    personNode(origin, content, {
      contact: content.contact,
      experiences: content.experiences,
      skills: [...primary.core, ...primary.aiEngineeringFocus, ...secondary],
    }),
  ]);
}

function graph(nodes: readonly object[]): object {
  return { "@context": "https://schema.org", "@graph": nodes };
}

function siteIds(origin: string) {
  return { website: `${origin}/#website`, person: `${origin}/#person` };
}

/** A main page as a WebPage about the person, part of the website, with its main list if any. */
function webPage(origin: string, page: PageText, mainEntity: string | null): object {
  const ids = siteIds(origin);
  return {
    "@type": "WebPage",
    "@id": `${page.url}#webpage`,
    url: page.url,
    name: page.title,
    description: page.description,
    inLanguage: "en",
    isPartOf: { "@id": ids.website },
    about: { "@id": ids.person },
    ...(mainEntity === null ? {} : { mainEntity: { "@id": mainEntity } }),
  };
}

/** What a page states about the person beyond the name and headline; each part is optional. */
interface PersonFacts {
  readonly image?: string | null;
  readonly contact?: HomepageProfile["contact"];
  readonly experiences?: readonly StructuredRole[];
  readonly skills?: readonly StructuredSkill[];
}

/**
 * The person: name, headline and the homepage, then only what the page holds — a photo, an email,
 * web links, the titles and employers of the current main jobs and own businesses (never side
 * projects or ended roles), each once, and the technologies' names, each once.
 */
function personNode(
  origin: string,
  person: { readonly name: string; readonly headline: string },
  facts: PersonFacts,
): object {
  const current = (facts.experiences ?? []).filter(
    (role) => role.endedOn === null && role.kind !== "side_project",
  );
  const titles = unique(current.map((role) => role.title));
  const employers = uniqueBy(
    current.map((role) => role.organization),
    (organization) => organization.name,
  ).map((organization) => ({
    "@type": "Organization",
    name: organization.name,
    ...(isWebAddress(organization.website) ? { url: organization.website } : {}),
  }));
  const skills = unique((facts.skills ?? []).map((skill) => skill.name));
  const links = (facts.contact?.links ?? []).map((link) => link.url);
  const email = facts.contact?.email ?? null;
  return {
    "@type": "Person",
    "@id": siteIds(origin).person,
    name: person.name,
    description: person.headline,
    url: `${origin}/`,
    ...(facts.image == null ? {} : { image: facts.image }),
    ...(email === null ? {} : { email: email.address }),
    ...(links.length === 0 ? {} : { sameAs: links }),
    ...oneOrMany("jobTitle", titles),
    ...oneOrMany("worksFor", employers),
    ...(skills.length === 0 ? {} : { knowsAbout: skills }),
  };
}

/** `{ [key]: value }` for one value, `{ [key]: values }` for several, `{}` for none. */
function oneOrMany(key: string, values: readonly unknown[]): Record<string, unknown> {
  if (values.length === 0) return {};
  return { [key]: values.length === 1 ? values[0] : values };
}

function nonEmpty(key: string, value: string): Record<string, string> {
  return value === "" ? {} : { [key]: value };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const name = key(value);
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

function isWebAddress(value: string | null): value is string {
  if (value === null || !URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "https:" || protocol === "http:";
}

const UNSAFE: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/**
 * JSON for a `<script type="application/ld+json">` element: the characters that could close the
 * element, open a comment or end a JavaScript line are written as `\u` escapes, so the text stays
 * the same data and can never become markup.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => UNSAFE[char] ?? char);
}
