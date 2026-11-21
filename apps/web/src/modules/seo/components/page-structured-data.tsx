import type { CvContent, ExperienceContent, ServicesContent } from "../../profile";
import { siteOrigin } from "../data/site-origin";
import {
  cvStructuredData,
  experienceStructuredData,
  serializeJsonLd,
  servicesStructuredData,
} from "../data/structured-data";

/** JSON-LD in a script element, serialized so that no text from the API can close it. */
function JsonLd({ data }: { readonly data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}

/** The experience page's schema.org JSON-LD on the canonical origin: the page, person and roles. */
export function ExperienceStructuredData({ content }: { readonly content: ExperienceContent }) {
  return <JsonLd data={experienceStructuredData(siteOrigin(), content)} />;
}

/** The services page's schema.org JSON-LD on the canonical origin: the page, person and services. */
export function ServicesStructuredData({ content }: { readonly content: ServicesContent }) {
  return <JsonLd data={servicesStructuredData(siteOrigin(), content)} />;
}

/** The CV's schema.org JSON-LD on the canonical origin: the person's profile page and the person. */
export function CvStructuredData({ content }: { readonly content: CvContent }) {
  return <JsonLd data={cvStructuredData(siteOrigin(), content)} />;
}
