import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getRoadmapBookshelf } from "../../../modules/profile";
import { bookshelfPageFacts, RoadmapBookshelfTemplate } from "../../../modules/roadmap";
import { RoadmapStructuredData, roadmapPageMetadata } from "../../../modules/seo";

/** Content cannot be read now; `error.tsx` shows it, never an empty bookshelf. */
class ContentUnavailableError extends Error {
  constructor() {
    super("The bookshelf's content could not be read from the API.");
    this.name = "ContentUnavailableError";
  }
}

/** The bookshelf; a profile that is not published yet is not found. */
async function readContent() {
  // Rendered on every request from the content cache (`modules/profile`), never at build time.
  await connection();
  const result = await getRoadmapBookshelf();
  if (result.status === "missing") notFound();
  if (result.status === "unavailable") throw new ContentUnavailableError();
  return result.content;
}

export async function generateMetadata(): Promise<Metadata> {
  return roadmapPageMetadata(bookshelfPageFacts(await readContent()));
}

export default async function RoadmapBookshelfPage() {
  const content = await readContent();
  return (
    <>
      <RoadmapStructuredData facts={bookshelfPageFacts(content)} />
      <RoadmapBookshelfTemplate content={content} />
    </>
  );
}
