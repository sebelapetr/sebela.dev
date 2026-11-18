import type { HomepageProfile } from "../../profile";

/** What the person's structured data rests on. */
export type StructuredProfile = Pick<
  HomepageProfile,
  "name" | "headline" | "shortBio" | "photo" | "contact"
>;

export function profileStructuredData(origin: string, profile: StructuredProfile): object {
  throw new Error(`not implemented: ${origin} ${profile.name}`);
}

export function serializeJsonLd(value: unknown): string {
  throw new Error(`not implemented: ${typeof value}`);
}
