import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getRoadmapEvents } from "../../../modules/profile";
import { EVENTS_NAME, RoadmapEventsTemplate } from "../../../modules/roadmap";

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

// Kept out of search results until the roadmap's SEO arrives (#115).
export async function generateMetadata(): Promise<Metadata> {
  const content = await readContent();
  return {
    title: `${EVENTS_NAME} — AI Roadmap — ${content.name}`,
    robots: { index: false },
  };
}

export default async function RoadmapEventsPage() {
  const content = await readContent();
  return <RoadmapEventsTemplate content={content} />;
}
