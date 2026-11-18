import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getRoadmap } from "../../modules/profile";
import { RoadmapOverviewTemplate, roadmapLead, toRoadmapOverview } from "../../modules/roadmap";

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

// Kept out of search results until the roadmap's canonical addresses, sitemap and structured
// data are completed with its later pages.
export async function generateMetadata(): Promise<Metadata> {
  const content = await readContent();
  const overview = toRoadmapOverview(content.roadmap);
  return {
    title: `AI Engineering Roadmap — ${content.name}`,
    description: overview.areas.length === 0 ? content.headline : roadmapLead(overview.facts),
    robots: { index: false },
  };
}

export default async function AiRoadmapPage() {
  const content = await readContent();
  return <RoadmapOverviewTemplate content={content} />;
}
