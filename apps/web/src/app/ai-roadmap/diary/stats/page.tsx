import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getRoadmapStatistics } from "../../../../modules/profile";
import { RoadmapStatisticsTemplate, statisticsPageFacts } from "../../../../modules/roadmap";
import { RoadmapStructuredData, roadmapPageMetadata } from "../../../../modules/seo";

/** Content cannot be read now; `error.tsx` shows it, never statistics of zero activity. */
class ContentUnavailableError extends Error {
  constructor() {
    super("The learning statistics could not be read from the API.");
    this.name = "ContentUnavailableError";
  }
}

async function readContent() {
  // Rendered on every request from the content cache (`modules/profile`), never at build time.
  await connection();
  const result = await getRoadmapStatistics();
  if (result.status === "missing") notFound();
  if (result.status === "unavailable") throw new ContentUnavailableError();
  return result.content;
}

export async function generateMetadata(): Promise<Metadata> {
  return roadmapPageMetadata(statisticsPageFacts(await readContent()));
}

export default async function RoadmapStatisticsPage() {
  const content = await readContent();
  return (
    <>
      <RoadmapStructuredData facts={statisticsPageFacts(content)} />
      <RoadmapStatisticsTemplate content={content} />
    </>
  );
}
