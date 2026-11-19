import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getRoadmapDiary } from "../../../modules/profile";
import { diaryPageFacts, RoadmapDiaryTemplate } from "../../../modules/roadmap";
import { RoadmapStructuredData, roadmapPageMetadata } from "../../../modules/seo";

/** Content cannot be read now; `error.tsx` shows it, never an empty diary. */
class ContentUnavailableError extends Error {
  constructor() {
    super("The learning diary's content could not be read from the API.");
    this.name = "ContentUnavailableError";
  }
}

async function readContent() {
  // Rendered on every request from the content cache (`modules/profile`), never at build time.
  await connection();
  const result = await getRoadmapDiary();
  if (result.status === "missing") notFound();
  if (result.status === "unavailable") throw new ContentUnavailableError();
  return result.content;
}

export async function generateMetadata(): Promise<Metadata> {
  return roadmapPageMetadata(diaryPageFacts(await readContent()));
}

export default async function RoadmapDiaryPage() {
  const content = await readContent();
  return (
    <>
      <RoadmapStructuredData facts={diaryPageFacts(content)} />
      <RoadmapDiaryTemplate content={content} />
    </>
  );
}
