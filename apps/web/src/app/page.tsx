import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { HomepageTemplate } from "../modules/homepage";
import { getHomepage } from "../modules/profile";
import { pageMetadata } from "../modules/seo";

/** Content cannot be read now; `error.tsx` shows it, never an empty profile. */
class ContentUnavailableError extends Error {
  constructor() {
    super("The homepage content could not be read from the API.");
    this.name = "ContentUnavailableError";
  }
}

async function readProfile() {
  // Rendered on every request: content is read at runtime, never at build time (caching is #56).
  await connection();
  const result = await getHomepage();
  if (result.status === "missing") notFound();
  if (result.status === "unavailable") throw new ContentUnavailableError();
  return result.profile;
}

export async function generateMetadata(): Promise<Metadata> {
  const profile = await readProfile();
  return pageMetadata("home", {
    name: profile.name,
    headline: profile.headline,
    summary: profile.shortBio,
  });
}

export default async function HomePage() {
  const profile = await readProfile();
  return <HomepageTemplate profile={profile} />;
}
