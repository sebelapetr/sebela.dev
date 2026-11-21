// The homepage's structured data (schema.org JSON-LD): the website, the profile page and the person
// it is about, from the profile the API supplies. It states only what the profile holds — name,
// headline, bio, photo, email and web links — and never derives skills or achievements.
import { plainText } from "../../_shared";
import type { HomepageProfile } from "../../profile";

/** What the person's structured data rests on. */
export type StructuredProfile = Pick<
  HomepageProfile,
  "name" | "headline" | "shortBio" | "photo" | "contact"
> & {
  readonly experiences: readonly StructuredRole[];
  readonly technologies: readonly { readonly name: string }[];
};

/** A role of the person's, as the person's structured data reads it. */
export interface StructuredRole {
  readonly slug: string;
  readonly title: string;
  readonly kind: "main_job" | "side_project" | "own_business";
  readonly endedOn: string | null;
  readonly summary: string;
  readonly organization: { readonly name: string; readonly website: string | null };
}

export interface StructuredExperience {
  readonly name: string;
  readonly headline: string;
  readonly experiences: readonly StructuredRole[];
  readonly technologies: readonly { readonly name: string }[];
}

export interface StructuredServices {
  readonly name: string;
  readonly headline: string;
  readonly intro: string | null;
  readonly services: readonly {
    readonly slug: string;
    readonly name: string;
    readonly summary: string;
    readonly audience: string;
  }[];
}

export interface StructuredCv {
  readonly name: string;
  readonly headline: string;
  readonly shortBio: string;
  readonly contact: HomepageProfile["contact"];
  readonly experiences: readonly StructuredRole[];
  readonly technologies: {
    readonly primary: {
      readonly core: readonly { readonly name: string }[];
      readonly aiEngineeringFocus: readonly { readonly name: string }[];
    };
    readonly secondary: readonly { readonly name: string }[];
  };
}

export function experienceStructuredData(origin: string, content: StructuredExperience): object {
  throw new Error("not implemented", { cause: [origin, content] });
}

export function servicesStructuredData(origin: string, content: StructuredServices): object {
  throw new Error("not implemented", { cause: [origin, content] });
}

export function cvStructuredData(origin: string, content: StructuredCv): object {
  throw new Error("not implemented", { cause: [origin, content] });
}

/** The schema.org graph of the homepage on `origin`: a WebSite, a ProfilePage and a Person. */
export function profileStructuredData(origin: string, profile: StructuredProfile): object {
  const home = `${origin}/`;
  const ids = {
    website: `${home}#website`,
    page: `${home}#profile-page`,
    person: `${home}#person`,
  };
  const bio = plainText(profile.shortBio);
  const links = profile.contact.links.map((link) => link.url);
  return {
    "@context": "https://schema.org",
    "@graph": [
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
        "@id": ids.page,
        url: home,
        name: `${profile.name} — ${profile.headline}`,
        ...(bio === "" ? {} : { description: bio }),
        isPartOf: { "@id": ids.website },
        mainEntity: { "@id": ids.person },
      },
      {
        "@type": "Person",
        "@id": ids.person,
        name: profile.name,
        description: profile.headline,
        url: home,
        ...(profile.photo === null ? {} : { image: new URL(profile.photo.url, home).href }),
        ...(profile.contact.email === null ? {} : { email: profile.contact.email.address }),
        ...(links.length === 0 ? {} : { sameAs: links }),
      },
    ],
  };
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
