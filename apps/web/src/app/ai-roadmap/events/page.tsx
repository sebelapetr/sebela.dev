import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getRoadmapEvents } from "../../../modules/profile";
import { eventsPageFacts, RoadmapEventsTemplate } from "../../../modules/roadmap";
import { RoadmapStructuredData, roadmapPageMetadata } from "../../../modules/seo";

/** Content cannot be read now; `error.tsx` shows it, never an empty list of events. */
class ContentUnavailableError extends Error {
  constructor() {
    super("The roadmap's events could not be read from the API.");
    this.name = "ContentUnavailableError";
  }
}

async function readContent() {
  // Rendered on every request from the content cache (`modules/profile`), never at build time.
  await connection();
  const result = await getRoadmapEvents();
  if (result.status === "missing") notFound();
  if (result.status === "unavailable") throw new ContentUnavailableError();
  return result.content;
}

export async function generateMetadata(): Promise<Metadata> {
  return roadmapPageMetadata(eventsPageFacts(await readContent()));
}

export default async function RoadmapEventsPage() {
  const content = await readContent();
  return (
    <>
      <RoadmapStructuredData facts={eventsPageFacts(content)} />
      <RoadmapEventsTemplate content={content} />
    </>
  );
}
