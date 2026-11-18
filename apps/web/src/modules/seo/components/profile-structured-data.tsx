import type { HomepageProfile } from "../../profile";
import { siteOrigin } from "../data/site-origin";
import { profileStructuredData, serializeJsonLd } from "../data/structured-data";

/**
 * The homepage's schema.org JSON-LD on the canonical origin: the website, the profile page and the
 * person. Serialized so that no text from the profile can close the script element.
 */
export function ProfileStructuredData({ profile }: { readonly profile: HomepageProfile }) {
  const json = serializeJsonLd(profileStructuredData(siteOrigin(), profile));
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
