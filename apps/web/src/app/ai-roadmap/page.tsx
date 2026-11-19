import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getRoadmap } from "../../modules/profile";
import { overviewPageFacts, RoadmapOverviewTemplate } from "../../modules/roadmap";
import { RoadmapStructuredData, roadmapPageMetadata } from "../../modules/seo";

/** Content cannot be read now; `error.tsx` shows it, never an empty roadmap. */
class ContentUnavailableError extends Error {
  constructor() {
    super("The AI Roadmap's content could not be read from the API.");
    this.name = "ContentUnavailableError";
  }
}

async function readContent() {
  // Rendered on every request from the content cache (`modules/profile`), never at build time.
  await connection();
  const result = await getRoadmap();
  if (result.status === "missing") notFound();
  if (result.status === "unavailable") throw new ContentUnavailableError();
  return result.content;
}

export async function generateMetadata(): Promise<Metadata> {
  return roadmapPageMetadata(overviewPageFacts(await readContent()));
}

export default async function AiRoadmapPage() {
  const content = await readContent();
  return (
    <>
      <RoadmapStructuredData facts={overviewPageFacts(content)} />
      <RoadmapOverviewTemplate content={content} />
    </>
  );
}
