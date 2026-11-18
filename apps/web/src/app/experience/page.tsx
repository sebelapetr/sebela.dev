import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ExperienceTemplate } from "../../modules/experience";
import { getExperience } from "../../modules/profile";
import { pageMetadata } from "../../modules/seo";

/** Content cannot be read now; `error.tsx` shows it, never an empty timeline. */
class ContentUnavailableError extends Error {
  constructor() {
    super("The experience page's content could not be read from the API.");
    this.name = "ContentUnavailableError";
  }
}

async function readContent() {
  // Rendered on every request: content is read at runtime, never at build time (caching is #56).
  await connection();
  const result = await getExperience();
  if (result.status === "missing") notFound();
  if (result.status === "unavailable") throw new ContentUnavailableError();
  return result.content;
}

export async function generateMetadata(): Promise<Metadata> {
  const content = await readContent();
  return pageMetadata("experience", { name: content.name, headline: content.headline });
}

export default async function ExperiencePage() {
  const content = await readContent();
  return <ExperienceTemplate content={content} />;
}
