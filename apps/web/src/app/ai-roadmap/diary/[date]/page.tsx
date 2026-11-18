import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getRoadmapDiaryDay } from "../../../../modules/profile";
import { DIARY_NAME, formatDiaryDate, RoadmapDiaryDayTemplate } from "../../../../modules/roadmap";

/** Content cannot be read now; `error.tsx` shows it, never a page without its day. */
class ContentUnavailableError extends Error {
  constructor() {
    super("The learning diary day's content could not be read from the API.");
    this.name = "ContentUnavailableError";
  }
}

interface DiaryDayPageProps {
  readonly params: Promise<{ readonly date: string }>;
}

/** The diary day the address names; a day without a record or an impossible date is not found. */
async function readContent(params: DiaryDayPageProps["params"]) {
  // Rendered on every request from the content cache (`modules/profile`), never at build time.
  await connection();
  const { date } = await params;
  const result = await getRoadmapDiaryDay(date);
  if (result.status === "missing") notFound();
  if (result.status === "unavailable") throw new ContentUnavailableError();
  return result.content;
}

// Kept out of search results until the roadmap's SEO arrives (#115).
export async function generateMetadata({ params }: DiaryDayPageProps): Promise<Metadata> {
  const content = await readContent(params);
  return {
    title: `${formatDiaryDate(content.day.date)} — ${DIARY_NAME} — AI Roadmap — ${content.name}`,
    robots: { index: false },
  };
}

export default async function RoadmapDiaryDayPage({ params }: DiaryDayPageProps) {
  return <RoadmapDiaryDayTemplate content={await readContent(params)} />;
}
