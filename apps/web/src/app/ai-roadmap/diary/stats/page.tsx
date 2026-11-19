import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getRoadmapStatistics } from "../../../../modules/profile";
import {
  DIARY_NAME,
  RoadmapStatisticsTemplate,
  STATISTICS_NAME,
} from "../../../../modules/roadmap";

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

// Kept out of search results until the roadmap's SEO arrives (#115).
export async function generateMetadata(): Promise<Metadata> {
  const content = await readContent();
  return {
    title: `${STATISTICS_NAME} — ${DIARY_NAME} — AI Roadmap — ${content.name}`,
    robots: { index: false },
  };
}

export default async function RoadmapStatisticsPage() {
  const content = await readContent();
  return <RoadmapStatisticsTemplate content={content} />;
}
