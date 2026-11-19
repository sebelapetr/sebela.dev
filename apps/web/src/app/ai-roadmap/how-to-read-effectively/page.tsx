import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getRoadmapReadingGuide } from "../../../modules/profile";
import { readingGuidePageFacts, RoadmapReadingGuideTemplate } from "../../../modules/roadmap";
import { RoadmapStructuredData, roadmapPageMetadata } from "../../../modules/seo";

/** Content cannot be read now; `error.tsx` shows it, never a page without whose roadmap it is. */
class ContentUnavailableError extends Error {
  constructor() {
    super("Whose reading guide it is could not be read from the API.");
    this.name = "ContentUnavailableError";
  }
}

/** Whose roadmap the guide belongs to; a profile that is not published yet is not found. */
async function readContent() {
  // Rendered on every request from the content cache (`modules/profile`), never at build time.
  await connection();
  const result = await getRoadmapReadingGuide();
  if (result.status === "missing") notFound();
  if (result.status === "unavailable") throw new ContentUnavailableError();
  return result.content;
}

export async function generateMetadata(): Promise<Metadata> {
  return roadmapPageMetadata(readingGuidePageFacts(await readContent()));
}

export default async function RoadmapReadingGuidePage() {
  const content = await readContent();
  return (
    <>
      <RoadmapStructuredData facts={readingGuidePageFacts(content)} />
      <RoadmapReadingGuideTemplate content={content} />
    </>
  );
}
